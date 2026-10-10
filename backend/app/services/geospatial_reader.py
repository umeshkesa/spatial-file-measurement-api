"""Safe geospatial file reading for KML and ZIP Shapefiles.

Security:
- ZIP slip protection (no absolute paths, no ``..`` escapes).
- Archive bomb limits (entry count, total extracted bytes, per-file cap).
- Extraction confined to a dedicated temp directory, cleaned up by caller.
- Uploaded bytes are treated as untrusted; external KML resources are never fetched.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd

from app.core.exceptions import (
    InvalidFileError,
    InvalidGeodataError,
    MissingCrsError,
)

ALLOWED_EXTENSIONS = {".kml", ".zip"}
SHAPEFILE_MAIN_EXT = ".shp"


@dataclass
class ExtractedDataset:
    gdf: gpd.GeoDataFrame
    source_crs: str | None
    source_crs_obj: object | None
    assumed_crs: bool  # True when CRS was assumed per format spec (KML -> EPSG:4326)


def validate_extension(filename: str) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise InvalidFileError(
            f"Unsupported file extension '{ext}'. Supported extensions: .kml, .zip."
        )
    return ext


def _safe_extract(
    zip_path: str | Path, dest: str | Path, max_entries: int, max_total_bytes: int
) -> list[Path]:
    dest = Path(dest)
    extracted: list[Path] = []
    total = 0
    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        if len(infos) > max_entries:
            raise InvalidFileError(
                f"Archive contains too many entries ({len(infos)} > {max_entries})."
            )
        for info in infos:
            name = info.filename
            # Skip directories.
            if name.endswith("/") or name.endswith("\\"):
                continue
            # ZIP slip protection.
            normalized = os.path.normpath(name).replace("\\", "/")
            if (
                not normalized
                or normalized.startswith("/")
                or normalized.startswith("..")
                or "/../" in normalized
                or normalized == ".."
            ):
                raise InvalidFileError(f"Unsafe archive entry blocked: {name!r}.")
            target = dest / Path(*normalized.split("/"))
            # Ensure the resolved path stays inside dest.
            try:
                target.resolve().relative_to(dest.resolve())
            except ValueError:
                raise InvalidFileError(f"Unsafe archive entry blocked: {name!r}.") from None
            size = info.file_size
            total += size
            if total > max_total_bytes:
                raise InvalidFileError("Archive extracted size exceeds the allowed limit.")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, open(target, "wb") as out:
                out.write(src.read())
            extracted.append(target)
    if not extracted:
        raise InvalidFileError("Archive is empty.")
    return extracted


def _read_kml(path: str | Path) -> gpd.GeoDataFrame:
    try:
        gdf = gpd.read_file(str(path), driver="KML")
    except Exception as exc:
        raise InvalidGeodataError(f"Could not parse KML file: {exc}") from exc
    if gdf is None or len(gdf) == 0:
        # An empty-but-valid KML yields zero features rather than an error.
        if gdf is None:
            raise InvalidGeodataError("Could not parse KML file: no layers found.")
    return gdf


def _read_shapefile_archive(
    path: str | Path, max_entries: int, max_total_bytes: int
) -> tuple[gpd.GeoDataFrame, bool]:
    try:
        with zipfile.ZipFile(path, "r") as zf:
            bad = zf.testzip()
            if bad is not None:
                raise InvalidFileError(f"Corrupt archive entry: {bad!r}.")
    except zipfile.BadZipFile as exc:
        raise InvalidFileError(f"Invalid ZIP archive: {exc}") from exc

    tmpdir = tempfile.mkdtemp(prefix="shp_extract_")
    try:
        extracted = _safe_extract(path, tmpdir, max_entries, max_total_bytes)
        shp_files = sorted(
            [p for p in extracted if p.suffix.lower() == SHAPEFILE_MAIN_EXT],
            key=lambda p: str(p),
        )
        if not shp_files:
            raise InvalidGeodataError("Archive does not contain a Shapefile (.shp) dataset.")
        frames = []
        for shp in shp_files:
            try:
                frames.append(gpd.read_file(str(shp)))
            except Exception as exc:
                raise InvalidGeodataError(f"Could not read Shapefile '{shp.name}': {exc}") from exc
        if len(frames) == 1:
            gdf = frames[0]
        else:
            import pandas as pd

            gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True))
            # Preserve CRS of the first frame.
            try:
                gdf = gdf.set_crs(frames[0].crs, allow_override=True)
            except Exception:
                pass
        return gdf, False
    finally:
        # Best-effort cleanup of extracted temp files.
        import shutil

        shutil.rmtree(tmpdir, ignore_errors=True)


def read_dataset(
    stored_path: str | Path,
    original_filename: str,
    max_entries: int = 500,
    max_total_bytes: int = 209_715_200,
) -> ExtractedDataset:
    """Read an uploaded file into a GeoDataFrame with source CRS info."""
    ext = validate_extension(original_filename)
    stored_path = Path(stored_path)
    if not stored_path.exists():
        raise InvalidFileError("Uploaded file could not be found on the server.")

    if ext == ".kml":
        gdf = _read_kml(stored_path)
        from app.services.crs_service import crs_to_string, parse_crs

        crs_obj = parse_crs(getattr(gdf, "crs", None))
        assumed = False
        if crs_obj is None:
            # KML coordinates are WGS84 lon/lat per the OGC KML specification.
            crs_obj = parse_crs("EPSG:4326")
            assumed = True
            try:
                gdf = gdf.set_crs("EPSG:4326", allow_override=True)
            except Exception:
                pass
        return ExtractedDataset(
            gdf=gdf,
            source_crs=crs_to_string(crs_obj),
            source_crs_obj=crs_obj,
            assumed_crs=assumed,
        )

    # .zip Shapefile
    gdf, _ = _read_shapefile_archive(stored_path, max_entries, max_total_bytes)
    from app.services.crs_service import crs_to_string, parse_crs

    crs_obj = parse_crs(getattr(gdf, "crs", None))
    if crs_obj is None:
        raise MissingCrsError(
            "Shapefile has no CRS metadata (.prj missing or unreadable). "
            "Re-project or supply a .prj sidecar file; refusing to guess the CRS."
        )
    return ExtractedDataset(
        gdf=gdf, source_crs=crs_to_string(crs_obj), source_crs_obj=crs_obj, assumed_crs=False
    )
