# 🐌 Den Den Mushi Intercom — Buster Call Web

<div align="center">
  <img src="public/images/dendenmushi/denden_activo.png" alt="Den Den Mushi Logo" width="160" style="filter: drop-shadow(0px 10px 20px rgba(14, 165, 233, 0.4));" />
  
  <p align="center">
    <strong>Intercomunicador de voz P2P en tiempo real inspirado en el caracol telefónico de One Piece.</strong><br />
    <em>Diseñado para moteros y copilotos, con cancelación de ruido ambiental activa y PWA instalable.</em>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/Supabase-JS--SDK-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/WebRTC-P2P--VoIP-FF6F61?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC" />
    <img src="https://img.shields.io/badge/PWA-Ready-00A3E0?style=for-the-badge&logo=progressive-web-apps&logoColor=white" alt="PWA" />
    <img src="https://img.shields.io/badge/License-MIT-brightgreen?style=for-the-badge" alt="MIT License" />
  </p>
</div>

---

## 🌟 Características Destacadas

*   **🎙️ Press-To-Talk (PTT) Táctil:** Micrófono cerrado por defecto para no saturar el canal de voz. Sistema altamente optimizado con Pointer Events responsivos para móviles y pantallas táctiles.
*   **🔒 Swipe Up to Lock (Manos Libres):** Desliza el botón de intercomunicación hacia arriba para bloquear el micrófono abierto continuamente. Viene con efectos de sonido retro e indicadores visuales dinámicos.
*   **📶 Canales WebRTC P2P Directos:** Enlaces de voz seguros de baja latencia con señalización en tiempo real gestionada por canales Postgres de Supabase.
*   **🔊 Filtro Inteligente de Audio:** Incluye cancelación de eco acústico, reducción de ganancia automática y filtros pasa-altos pensados para filtrar el sonido del viento en motociclistas.
*   **📡 Sincronización en Tiempo Real:** Visualización en vivo de salas activas, amigos enlazados y estado de conexión mediante Supabase Realtime.
*   **📱 Experiencia PWA Premium:** Instálalo como aplicación nativa en iOS, Android o PC con soporte offline nativo gracias a su Service Worker.

---

## 🎨 Estética & Diseño Premium

La interfaz se ha confeccionado cuidando al máximo la experiencia de usuario:
*   **Dark Mode Profundo:** Con colores HSL curados (`slate-950` y destellos `sky-500` / `emerald-400`).
*   **Glassmorphism:** Tarjetas y paneles semitransparentes con bordes resplandecientes difuminados para dar un aspecto tridimensional.
*   **Den Den Mushi Interactivo:** Animaciones y cambios de imagen de estado automáticos en el caracol cuando el otro usuario está hablando, durmiendo, transmitiendo o silenciado.

---

## 📁 Estructura del Proyecto

```markdown
├── 📁 .github/workflows/   # Pipeline de despliegue automatizado para GitHub Pages
├── 📁 database/            # Scripts SQL para la base de datos de Supabase (tablas y triggers)
├── 📁 public/              # Recursos multimedia (imágenes del caracol, efectos de audio)
│   ├── 📁 images/dendenmushi/
│   └── 📁 sounds/
├── 📁 src/                 # Lógica de la aplicación
│   ├── 📄 audio.js         # Filtros Web Audio API, cancelación de ruido y reproducción
│   ├── 📄 webrtc.js        # Motor de señalización P2P e intercambio ICE
│   ├── 📄 supabase.js      # Consultas y autenticación con Supabase
│   ├── 📄 main.js          # Control de vistas y eventos táctiles PTT
│   └── 📄 index.css        # Estilos visuales personalizados
├── 📄 vite.config.js       # Configuración inteligente de Vite para entornos múltiples
└── 📄 vercel.json          # Configuración de enrutamiento optimizada para Vercel
```

---

## 🚀 Guía de Configuración Local

### 1. Clonar el repositorio
```bash
git clone https://github.com/tony-ssr/Den-Den-Mushi-Web.git
cd Den-Den-Mushi-Web
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Crear variables de entorno
Crea un archivo `.env` en la raíz del proyecto y agrega tus credenciales de Supabase:
```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-de-supabase
```

### 4. Configurar la base de datos (Supabase)
1. Entra al **SQL Editor** en tu panel de Supabase.
2. Ejecuta el script de creación: **[database/Script Maestro Completo (Re-crear todo desde cero).txt](database/Script%20Maestro%20Completo%20(Re-crear%20todo%20desde%20cero).txt)**.
3. *Opcional:* Si estás en desarrollo, recuerda **desactivar la confirmación obligatoria de correo electrónico** en *Auth -> Providers -> Email -> Confirm email* en tu panel de Supabase para poder registrar cuentas de prueba al instante.

### 5. Correr en servidor de desarrollo
```bash
npm run dev
```

---

## 🚢 Guía de Despliegue en Producción

### En Vercel (Recomendado para Web)
1. Importa tu repositorio en el panel de **Vercel**.
2. Añade las dos variables del `.env` (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`) en el paso de variables de entorno.
3. Vercel detectará la configuración automáticamente y compilará la app.

### En GitHub Pages (Automatizado con Actions)
El repositorio incluye un archivo de GitHub Actions listo para compilar y desplegar tu web automáticamente.
1. Ve a **Settings -> Actions -> General** en tu repositorio y asegúrate de dar permisos de escritura en la sección *Workflow permissions* (**Read and write permissions**).
2. Ve a **Settings -> Pages** y bajo *Build and deployment*, selecciona **GitHub Actions** en la fuente (*Source*).
3. Añade tus secretos en **Settings -> Secrets and variables -> Actions** con los nombres de:
   * `VITE_SUPABASE_URL`
   * `VITE_SUPABASE_ANON_KEY`
4. Al hacer `git push origin main`, se generará y publicará tu aplicación de forma automática.

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para obtener más detalles.
