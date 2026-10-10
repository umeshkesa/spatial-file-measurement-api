"""Upload orchestration: save bytes, extract features, measure, persist.

Synchronous processing is used deliberately: upload-size limits keep requests
bounded, state is persisted before/after processing, and no in-memory job can
be silently lost on restart.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from shapely.geometry import mapping
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import AppError
from app.core.logging import get_logger
from app.models.feature_record import FeatureRecord
from app.models.file_record import FileRecord
from app.repositories import feature_repository, file_repository
from app.services import crs_service, geospatial_reader
from app.services.measurement_service import measure_collection, measure_projected

log = get_logger(__name__)


def _safe_properties(raw: object) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        out: dict = {}
        for key, value in raw.items():
            try:
                json.dumps(value)
                out[str(key)] = value
            except Exception:
                out[str(key)] = str(value)
        return out
    return {"value": str(raw)}


def _geometry_to_geojson_dict(geom) -> dict | None:
    if geom is None:
        return None
    try:
        if geom.is_empty:
            return None
        return mapping(geom)
    except Exception:
        return None


def _jsonable(value: object) -> str | None:
    try:
        if value is None:
            return None
        return json.dumps(value, default=str)
    except Exception:
        return json.dumps({"value": str(value)})


def save_upload_bytes(
    content: bytes, original_filename: str, settings: Settings
) -> tuple[str, str]:
    """Persist raw upload bytes under a generated storage name.

    Returns (file_id, storage_path). Never trusts client paths.
    """
    file_id = uuid.uuid4().hex
    ext = Path(original_filename or "").suffix.lower()
    storage_dir = Path(settings.storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"{file_id}{ext}"
    storage_path = storage_dir / storage_name
    storage_path.write_bytes(content)
    return file_id, str(storage_path)


def process_upload(
    session: Session,
    settings: Settings,
    *,
    file_id: str,
    original_filename: str,
    storage_path: str,
) -> FileRecord:
    """Extract, measure and persist all features for an uploaded file.

    Creates the FileRecord in PROCESSING state first (committed by caller or
    flushed here), then processes, then updates the final outcome. Per-feature
    failures are isolated: one bad feature never aborts the dataset.
    """
    record = FileRecord(
        id=file_id,
        original_filename=original_filename,
        storage_key=storage_path,
        source_crs=None,
        measurement_crs=None,
        feature_count=0,
        status="PROCESSING",
        error_summary=None,
        created_at=datetime.utcnow(),
    )
    file_repository.create(session, record)
    session.commit()  # persist PROCESSING state before expensive work

    try:
        dataset = geospatial_reader.read_dataset(
            storage_path,
            original_filename,
            max_entries=settings.max_archive_entries,
            max_total_bytes=settings.max_extracted_bytes,
        )
    except AppError as exc:
        record.status = "FAILED"
        record.error_summary = exc.message
        record.feature_count = 0
        session.commit()
        raise

    gdf = dataset.gdf
    source_crs_str = dataset.source_crs
    source_crs_obj = dataset.source_crs_obj

    try:
        measurement_crs = crs_service.select_measurement_crs(source_crs_obj, gdf)
    except AppError as exc:
        record.status = "FAILED"
        record.source_crs = source_crs_str
        record.error_summary = exc.message
        record.feature_count = len(gdf)
        session.commit()
        raise

    feature_rows: list[FeatureRecord] = []
    n_failed = 0
    n_unsupported = 0

    for idx, (_, row) in enumerate(gdf.iterrows()):
        try:
            geom = row.geometry
            props = _safe_properties({k: v for k, v in dict(row).items() if k != "geometry"})
            if geom is None:
                geometry_type = "Unknown"
                geojson_dict = None
                result_status = "FAILED"
                feature_rows.append(
                    FeatureRecord(
                        file_id=file_id,
                        feature_index=idx,
                        geometry_type=geometry_type,
                        geometry_json=None,
                        properties_json=_jsonable(props),
                        measurement_type=None,
                        measurement_value=None,
                        measurement_unit=None,
                        measurement_status=result_status,
                        error_details="Null geometry.",
                    )
                )
                n_failed += 1
                continue
            try:
                geometry_type = geom.geom_type
            except Exception:
                geometry_type = "Unknown"
            geojson_dict = _geometry_to_geojson_dict(geom)
            # Transform a copy to measurement CRS for planar math.
            try:
                projected = crs_service.transform_geometry(geom, source_crs_obj, measurement_crs)
            except Exception as exc:
                feature_rows.append(
                    FeatureRecord(
                        file_id=file_id,
                        feature_index=idx,
                        geometry_type=geometry_type,
                        geometry_json=_jsonable(geojson_dict),
                        properties_json=_jsonable(props),
                        measurement_type=None,
                        measurement_value=None,
                        measurement_unit=None,
                        measurement_status="FAILED",
                        error_details=f"CRS transformation failed: {exc}",
                    )
                )
                n_failed += 1
                continue
            if geometry_type == "GeometryCollection":
                result, component_results = measure_collection(projected, geometry_type)
                components_json = _jsonable(
                    [
                        {
                            "geometry_type": c.geometry_type,
                            "measurement_type": c.measurement_type,
                            "measurement_value": c.value,
                            "measurement_unit": c.unit,
                            "measurement_status": c.status,
                            "error_details": c.error,
                        }
                        for c in component_results
                    ]
                )
            else:
                result = measure_projected(projected, geometry_type)
                components_json = None
            if result.status == "FAILED":
                n_failed += 1
            elif result.status == "UNSUPPORTED":
                n_unsupported += 1
            err = result.error
            if result.repaired:
                err = ((err + "; ") if err else "") + "Geometry repaired with make_valid."
            feature_rows.append(
                FeatureRecord(
                    file_id=file_id,
                    feature_index=idx,
                    geometry_type=geometry_type,
                    geometry_json=_jsonable(geojson_dict),
                    properties_json=_jsonable(props),
                    measurement_type=result.measurement_type,
                    measurement_value=result.value,
                    measurement_unit=result.unit,
                    measurement_status=result.status,
                    error_details=err,
                    components_json=components_json,
                )
            )
        except Exception as exc:  # last-resort per-feature isolation
            log.warning("Feature %d failed: %s", idx, exc)
            n_failed += 1
            feature_rows.append(
                FeatureRecord(
                    file_id=file_id,
                    feature_index=idx,
                    geometry_type="Unknown",
                    geometry_json=None,
                    properties_json="{}",
                    measurement_type=None,
                    measurement_value=None,
                    measurement_unit=None,
                    measurement_status="FAILED",
                    error_details=f"Unexpected feature failure: {exc}",
                )
            )

    # Persist features in a fresh transaction (processing happened outside any txn).
    try:
        feature_repository.bulk_create(session, feature_rows)
        if n_failed > 0 or n_unsupported > 0:
            record.status = "COMPLETED_WITH_ERRORS"
            record.error_summary = (
                f"{n_failed} failed, {n_unsupported} unsupported "
                f"out of {len(feature_rows)} features."
            )
        else:
            record.status = "COMPLETED"
            record.error_summary = None
        record.feature_count = len(feature_rows)
        record.source_crs = source_crs_str
        record.measurement_crs = measurement_crs
        session.commit()
    except Exception as exc:
        session.rollback()
        record.status = "FAILED"
        record.error_summary = f"Could not persist results: {exc}"
        session.commit()
        raise
    return record
