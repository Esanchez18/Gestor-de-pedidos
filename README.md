# Pirañalab Pedidos

Gestor personal de pedidos para un emprendimiento de impresión 3D. Está hecho con React, TypeScript y Vite. Guarda pedidos, clientes, imágenes e historial en `localStorage`; no usa servidor, base de datos, cuenta ni servicios externos.

## Importante sobre los datos

Los datos permanecen en el navegador y perfil donde los cargaste. No se sincronizan con otros dispositivos ni con otros navegadores. Borrar los datos del sitio, cambiar de perfil o usar otro dispositivo puede hacer que dejen de estar disponibles. En Configuración podés descargar e importar una copia JSON. Guardá los respaldos en un lugar seguro.

Las imágenes de referencia también se guardan en el navegador y se limitan a 700 KB por imagen para cuidar el espacio disponible. GitHub Pages publica los archivos de la aplicación; nunca recibe tus pedidos.

## Requisitos y uso local

Necesitás Node.js 20 o posterior y npm.

```sh
npm install
npm run dev
```

Abrí la dirección local que muestre Vite. No hay que crear variables de entorno ni configurar servicios.

## Comandos

```sh
npm run dev       # desarrollo local
npm run typecheck # chequeo de TypeScript
npm run build     # aplicación estática en dist/
npm run preview   # previsualizar el build local
```

## Publicar gratis en GitHub Pages

1. Creá un repositorio en GitHub y subí esta carpeta. No incluyas `node_modules` ni `dist`.
2. En el repositorio, abrí Settings → Pages y seleccioná GitHub Actions como fuente.
3. El workflow `.github/workflows/pages.yml` compila y publica el sitio cada vez que se actualiza la rama `main`.
4. Cuando termine el workflow, GitHub mostrará el enlace gratuito `https://USUARIO.github.io/REPOSITORIO/`. La navegación por hash permite abrir y recargar sus pantallas directamente.

GitHub Pages incluye un subdominio `github.io` sin costo. También podés conectar un dominio propio si ya tenés uno; el registro de dominios personalizados suele tener costo.

## Git inicial

```sh
git init
git add .
git commit -m "Crear Pirañalab Pedidos"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

Después de subirlo, activá Pages como se describe arriba. Este proyecto no crea repositorios ni publica nada por sí solo.
