#!/bin/sh
# Construye el mapa de carreteras de España (teselas de Valhalla) a partir de
# OpenStreetMap: península, Baleares, Ceuta, Melilla y Canarias.
# Resultado: work/tiles/{0,1,2}/... (.gph)
#
# La imagen de Valhalla debe ser la MISMA versión que el motor del navegador
# (engine/VALHALLA_VERSION); si no, el motor rechaza las teselas.
set -e
cd "$(dirname "$0")/.."
V=$(cat engine/VALHALLA_VERSION)
IMAGE=${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla-scripted:$V}
W=work
mkdir -p "$W"

# Geofabrik publica Canarias aparte (en África).
[ -f "$W/espana.osm.pbf" ] || curl -fL --retry 3 https://download.geofabrik.de/europe/spain-latest.osm.pbf -o "$W/espana.osm.pbf"
[ -f "$W/canarias.osm.pbf" ] || curl -fL --retry 3 https://download.geofabrik.de/africa/canary-islands-latest.osm.pbf -o "$W/canarias.osm.pbf"
ls -lh "$W"/*.osm.pbf

rm -rf "$W/tiles"
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/$W":/data --entrypoint sh "$IMAGE" -c '
  set -e
  valhalla_build_config --mjolnir-tile-dir /data/tiles --mjolnir-tile-extract "" \
    --mjolnir-traffic-extract "" --mjolnir-admin /data/admins.sqlite --mjolnir-timezone "" \
    --additional-data-elevation "" > /data/valhalla.json
  valhalla_build_admins -c /data/valhalla.json /data/espana.osm.pbf /data/canarias.osm.pbf
  valhalla_build_tiles -c /data/valhalla.json /data/espana.osm.pbf /data/canarias.osm.pbf
'
echo "Teselas: $(find "$W/tiles" -name '*.gph' | wc -l) archivos, $(du -sh "$W/tiles" | cut -f1)"
