# Ligas de Fútbol

Sitio estático para ligas regionales de fútbol amateur de Argentina. Muestra un mapa con las ligas adheridas y, para cada liga, sus posiciones, fechas, goleadores, noticias y clubes. Cada visitante puede elegir su liga y su equipo y recibir avisos de sus partidos.

Los datos viven en una planilla de Google Sheets. Los admins de cada club los cargan desde AppSheet, y el sitio los lee a través de una API hecha con Apps Script.

Ejemplo cargado: Liga de Fútbol de Bolívar, Copa Centenario 2026, Primera división.

## Estructura

| Archivo | Qué es |
| --- | --- |
| `index.html` | Página única del sitio |
| `css/estilos.css` | Estilos |
| `js/config.js` | Configuración: URL de la API y frecuencia de los avisos |
| `js/app.js` | Rutas, cálculos (posiciones, goleadores) y avisos en vivo |
| `js/admin.js` | Panel de clubes (`#/admin`): ingreso con Google y carga de datos |
| `js/mapa.js` | Mapa interactivo de Argentina en SVG (sin servicios externos) |
| `data/argentina.json` | Límites provinciales simplificados, de Natural Earth (dominio público) |
| `data/snapshot.json` | Copia de los datos para cuando la API no está configurada |
| `backend/Code.gs` | API de Apps Script que lee la planilla |

## Publicar en GitHub Pages

1. Subí estos archivos a la rama `main` del repositorio.
2. En GitHub andá a Settings > Pages.
3. En "Build and deployment" elegí "Deploy from a branch", rama `main`, carpeta `/ (root)`, y guardá.
4. En uno o dos minutos el sitio queda en `https://creamix-ds.github.io/ligasdefutbol/`.

Para usar un dominio propio, cargalo en Settings > Pages > Custom domain y configurá el DNS como indica GitHub.

## Conectar la planilla (API)

1. Abrí la planilla y andá a Extensiones > Apps Script.
2. Pegá el contenido de `backend/Code.gs` en un archivo del proyecto. `API_PLANILLA_ID` ya tiene el ID de la planilla.
3. Implementar > Nueva implementación > Aplicación web. Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario.
4. Copiá la URL que termina en `/exec` y pegala en `API_URL` dentro de `js/config.js`.

Sin `API_URL`, el sitio usa `data/snapshot.json`.

La API responde, entre otros, a:
- `?r=posiciones&torneo=T01`
- `?r=partidos&torneo=T01&fecha=13`
- `?r=goleadores&torneo=T01`

## Velocidad de carga

El sitio pide todos los datos en un solo pedido (`?r=todo`). Apps Script guarda esa respuesta en caché 10 minutos, y cada cambio que se hace desde el panel la renueva al instante. Los cambios hechos a mano en la planilla pueden tardar hasta 10 minutos en verse.

El navegador guarda una copia de la última visita. Desde la segunda vez, el sitio aparece al instante con esa copia y se actualiza solo cuando llegan los datos nuevos.

Para que tampoco espere el primer visitante después de que vence la caché, se puede sumar un activador en Apps Script: Activadores > Agregar activador > función `calentarCache`, fuente "Según el tiempo", cada 5 minutos.

## Avisos de partidos

Desde "Mi equipo", el visitante elige su liga y su equipo, y el navegador le pide permiso para mostrar avisos. Con la API configurada, el sitio revisa los partidos de ese equipo cada 60 segundos y avisa cuando:
- empieza el partido (el estado pasa a "En juego"),
- hay un gol,
- termina el partido.

Para que esto funcione, el admin del club tiene que cambiar el estado del partido a "En juego" y cargar los goles mientras se juega.

Por ahora los avisos llegan solo con el sitio abierto, aunque esté en otra pestaña. Para recibirlos con el sitio cerrado hay que integrar Firebase Cloud Messaging: un service worker en el sitio y un envío desde Apps Script cuando cambia un partido. Ese es el próximo paso.

## Datos

Cada liga tiene sus propias pestañas para Clubes, Equipos, Jugadores, Torneos, Partidos, Eventos y Noticias, con el código de la liga al final: `Partidos_L01` es Bolívar, `Partidos_L02` es Olavarría, y así. Todas las pestañas de una misma tabla tienen las mismas columnas. Ligas, Usuarios, Suscripciones, Fuentes y Registro son pestañas únicas.

La API lee juntas todas las pestañas de una tabla y, cuando el panel carga un dato, lo escribe en la pestaña de su liga. Si una liga nueva todavía no tiene su pestaña, la crea. Los códigos (`P058`, `J070`...) no se repiten entre ligas.

En las pestañas Partidos, el campo `estado` puede valer `Programado`, `En juego`, `Finalizado` o `Postergado`.

Cuando no se conoce el marcador, se carga el ganador en `resultado_manual` (`L`, `E` o `V`). Ese partido suma puntos, pero no goles.

Las fuentes de los datos del ejemplo están en la pestaña Fuentes de la planilla.

## Torneos y participantes

La columna `participantes` de Torneos dice qué equipos juegan cada torneo. Lleva códigos separados por comas: una liga entera (`L01`), un club (`CL05`) o un equipo (`E07`). Si está vacía, juega toda la liga del torneo. De las ligas y los clubes se toman los equipos de la categoría del torneo.

Desde el panel (Torneos > Agregar torneo) se eligen con casillas: "Toda la liga" o clubes sueltos, de cualquier liga.

- Si los equipos son de una sola liga, el torneo aparece en la página de esa liga. Cuando una liga tiene varios torneos con partidos, se puede cambiar de uno a otro.
- Si mezcla equipos de distintas ligas (por ejemplo, el Regional Federal Amateur), aparece en el apartado Torneos del sitio (`#/torneos`), con su tabla, fixture, goleadores y equipos. También figura en la ficha de cada club que juega.

La "Liga organizadora" es la liga en cuyas pestañas se guardan los partidos del torneo. Al cargar el fixture, el panel solo ofrece los equipos que juegan ese torneo, y la API rechaza un partido con un equipo de afuera.

## Direcciones de las ligas

Cada liga tiene una dirección con su nombre, por ejemplo `https://creamix-ds.github.io/ligasdefutbol/#/liga/LigadeBolivar`. Sale de la columna `slug` de la pestaña Ligas. Si esa celda está vacía, se arma con el nombre de la liga sin tildes, sin espacios y sin la palabra "Fútbol". Los links viejos con el código (`#/liga/L01`) siguen funcionando y pasan solos a la dirección con nombre.

## Mapa

El mapa de la portada es propio: un SVG con las 24 jurisdicciones, incluidas las Islas Malvinas como parte de Tierra del Fuego. No depende de Google Maps ni de otros servicios.

Cada liga aparece donde indican sus columnas `lat` y `lng` de la pestaña Ligas. La provincia se pinta según la columna `provincia`, que tiene que coincidir con el nombre oficial, por ejemplo "Buenos Aires" o "Córdoba".

Para navegar el mapa:
- arrastrar mueve el mapa,
- los botones +, − y el doble clic acercan o alejan,
- Ctrl + rueda hace zoom,
- en celular se usa el gesto de pellizcar.

## Panel de administración

El panel está en `https://creamix-ds.github.io/ligasdefutbol/#/admin`, y en el pie del sitio aparece el link "Acceso para ligas y clubes". Se ingresa con una cuenta de Google. El email de esa cuenta tiene que estar en la pestaña Usuarios con `activo = SI`.

| Rol | Qué puede hacer |
| --- | --- |
| `dev` | Todo: fixture, clubes y categorías, torneos, ligas, usuarios, resultados, planteles y noticias |
| `admin_club` | Cargar resultados, goles y tarjetas de los partidos de su club; editar su plantel y los datos del club; publicar noticias en su liga |

Los permisos los controla la API en Apps Script: el sitio solo oculta lo que cada rol no puede usar. Cada cambio queda anotado en la pestaña Registro, con fecha, email, acción, tabla y datos.

### Activarlo, una sola vez

1. **Crear el ID de cliente de Google.**
   1. Entrá a [Google Cloud Console](https://console.cloud.google.com/) con tu cuenta y creá un proyecto, por ejemplo "Ligas de Fútbol".
   2. Configurá la pantalla de consentimiento de OAuth (en "Google Auth Platform"): tipo Externo, nombre de la app y tu email. Después publicala ("Publicar app"). Como solo pide nombre y email, no necesita verificación de Google.
   3. En Clientes (o Credenciales), creá un ID de cliente de OAuth de tipo "Aplicación web".
   4. En "Orígenes autorizados de JavaScript" agregá `https://creamix-ds.github.io`. Si vas a probar en tu computadora, sumá también `http://localhost:8000`.
   5. Copiá el ID de cliente. Termina en `.apps.googleusercontent.com`.
2. **Pegar el ID en dos lugares:**
   - en `GOOGLE_CLIENT_ID` dentro de `js/config.js`,
   - en `GOOGLE_CLIENT_ID` dentro de `backend/Code.gs`.
3. **Actualizar Apps Script.**
   1. Pegá el `Code.gs` nuevo.
   2. Andá a Implementar > Administrar implementaciones > editar (lápiz) > Versión: "Nueva versión" > Implementar. Así la URL `/exec` no cambia.
   3. La primera vez Google te pide un permiso nuevo, "Conectarse a un servicio externo". Sirve para verificar el ingreso con Google. Aceptalo.
4. **Cargar los usuarios.** Desde el panel, como dev, entrá a Usuarios > Agregar usuario. También se puede cargar directamente en la pestaña Usuarios.

### Durante un partido

El admin del club abre el partido en Resultados y hace lo siguiente:
1. Marca "En juego".
2. Registra cada gol con el jugador y el minuto.
3. Al terminar, marca "Finalizado".

El marcador se actualiza solo con cada gol. Si el jugador no está en el plantel, se lo agrega en el momento con la opción "Otro: agregar al plantel".
