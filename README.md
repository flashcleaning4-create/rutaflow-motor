# RutaFlow · motor de rutas sin coste

Prueba de concepto para que RutaFlow funcione **sin pagar por uso**:

| Función | Con qué | Coste |
|---|---|---|
| Mapa | MapLibre + [OpenFreeMap](https://openfreemap.org) | 0 € |
| Buscar direcciones y tocar el mapa | [CartoCiudad](https://www.cartociudad.es) (IGN) | 0 € |
| Optimizar el orden, calcular la ruta, indicaciones en español | [Valhalla](https://github.com/valhalla/valhalla) **dentro del móvil** (WebAssembly) | 0 € |
| Mapa de carreteras de toda España (península, Baleares, Canarias, Ceuta y Melilla) | OpenStreetMap, construido cada mes por GitHub | 0 € |
| Publicación de la web | Cloudflare Pages (plan gratuito) | 0 € |

Ningún paso pide tarjeta. GitHub Actions es gratis en repositorios públicos y el plan gratuito de Cloudflare Pages no cobra.

## Cómo funciona

1. Cada mes, una tarea automática de GitHub descarga el mapa de España de OpenStreetMap y genera el «mapa de carreteras» que usa el motor (unas mil piezas comprimidas, de 0,25° cada una).
2. Lo publica con la página de prueba en Cloudflare Pages.
3. En el móvil, el motor descarga **solo las piezas de la zona donde están tus paradas**, las guarda en el navegador y calcula allí las rutas. No hay servidor de rutas.

## Puesta en marcha, paso a paso

### Paso 1. Subir este proyecto a GitHub

1. Entra en <https://github.com> con tu cuenta (o créala gratis).
2. Arriba a la derecha, **+ → New repository**.
3. Nombre: `rutaflow-motor`. Marca **Public** (así GitHub da gratis máquinas más grandes y minutos ilimitados; aquí no hay contraseñas ni datos tuyos). No marques nada más. **Create repository**.
4. En la página del repositorio vacío, pulsa **uploading an existing file**.
5. Descomprime el zip en tu ordenador, abre la carpeta `rutaflow-motor` y **arrastra todo su contenido** (incluida la carpeta `.github`) a la ventana de GitHub.
6. Abajo, **Commit changes**.

### Paso 2. Crear la cuenta gratuita de Cloudflare y sus dos claves

1. Entra en <https://dash.cloudflare.com/sign-up> y crea la cuenta (solo correo y contraseña).
2. **Identificador de cuenta:** en el panel, menú **Workers & Pages**. A la derecha verás **Account ID**: cópialo y guárdalo.
3. **Clave para publicar:** arriba a la derecha, icono de persona → **My Profile → API Tokens → Create Token**.
   - Baja hasta **Create Custom Token → Get started**.
   - Nombre: `rutaflow-motor`.
   - En **Permissions** elige: `Account` · `Cloudflare Pages` · `Edit`.
   - **Continue to summary → Create Token**. Copia la clave (solo se muestra una vez).

### Paso 3. Guardar las claves en GitHub

1. En tu repositorio de GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea dos secretos:
   - Nombre `CLOUDFLARE_API_TOKEN`, valor: la clave del paso 2.3.
   - Nombre `CLOUDFLARE_ACCOUNT_ID`, valor: el identificador del paso 2.2.

### Paso 4. Lanzar la primera construcción

1. En el repositorio, pestaña **Actions**. Si pide activar los workflows, acepta.
2. A la izquierda, **Publicar motor y mapa → Run workflow → Run workflow**.
3. La primera vez tarda **unas 2–3 horas**: unos 40 minutos para el motor y 1–2 horas para el mapa de España. No hace falta dejar el ordenador encendido; corre en GitHub.
4. Cuando termine con un ✔ verde, abre el resumen: indica cuántas piezas tiene el mapa y cuánto ocupan.

Después se repite sola el día 3 de cada mes para tener el mapa al día.

### Paso 5. Probar en el móvil

Abre **https://rutaflow-motor.pages.dev** en el móvil.

1. Busca tus direcciones reales o pega la lista del día en «Pegar una lista de direcciones». La primera es la salida.
2. Pulsa **Optimizar y calcular**.
3. Comprueba:
   - El orden y los kilómetros, comparando con «Comparar este orden en Google Maps».
   - Las **indicaciones en español** (el botón 🔊 las lee en voz alta).
   - Cuánto tarda y cuántos MB descarga la primera vez. La segunda vez en la misma zona no descarga nada.

Si algo falla, haz una captura del mensaje.

## Si la construcción falla

- **«Archivos de más de 25 MB»**: alguna pieza del mapa de una gran ciudad no cabe en Cloudflare Pages. El resumen dice cuál; se resuelve partiendo esa pieza.
- **Se queda sin memoria al construir el mapa**: el repositorio debe ser **público** (los privados tienen máquinas más pequeñas).
- Cualquier otro error: abre la ejecución en **Actions**, entra en el paso en rojo y copia las últimas líneas.

## Qué hay en cada carpeta

```
.github/workflows/publicar.yml   Tarea automática: motor + mapa + publicación
engine/                          Motor Valhalla para el navegador (copia de
                                 adret-maps/valhalla-wasm, licencia MIT) con dos
                                 funciones añadidas: tabla de tiempos y ruta optimizada
scripts/construir-teselas.sh     Mapa de carreteras de España desde OpenStreetMap
scripts/preparar-sitio.mjs       Comprime el mapa, comprueba límites y monta la web
prueba/                          Página de prueba (sin dependencias ni compilación)
tests/                           Pruebas: piezas del mapa y optimizador
```

## Créditos y licencias

- Datos del mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Mapa base: [OpenFreeMap](https://openfreemap.org) / OpenMapTiles.
- Direcciones: © [CartoCiudad](https://www.cartociudad.es), Instituto Geográfico Nacional (CC BY 4.0).
- Motor: [Valhalla](https://github.com/valhalla/valhalla) (MIT) compilado con [adret-maps/valhalla-wasm](https://github.com/adret-maps/valhalla-wasm) (MIT). Ver `engine/LICENSE` y `engine/THIRD_PARTY_NOTICES.md`.
