# Agente Autismo

Esta carpeta guarda en la nube todo el contenido de la carpeta **AUTISMO AGENT**
que tienes en el escritorio de tu PC. Así tienes un respaldo seguro y puedes
acceder a tus archivos desde cualquier lugar.

## Cómo subir tus archivos aquí

### Opción A — Desde la web de GitHub (la más fácil)

1. Entra a este repositorio en GitHub: https://github.com/josuegudiel/agentes-claude
2. Cambia a la rama **`agente-autismo`** (menú de ramas, arriba a la izquierda).
3. Entra a la carpeta **`agente-autismo`**.
4. Haz clic en **"Add file" → "Upload files"**.
5. Arrastra todos los archivos de tu carpeta local *AUTISMO AGENT* a la ventana.
6. Baja y haz clic en **"Commit changes"**.

> Nota: si tu carpeta tiene subcarpetas, arrastra la carpeta completa; GitHub
> mantiene la estructura.

### Opción B — Desde tu PC con Git (Windows PowerShell)

```powershell
# 1. Ir a tu carpeta local
cd "$HOME\Desktop\AUTISMO AGENT"

# 2. Copiar tus archivos dentro del repositorio ya clonado
#    (ajusta la ruta si clonaste el repo en otro lugar)
Copy-Item -Recurse -Force * "C:\ruta\a\agentes-claude\agente-autismo\"

# 3. Subir los cambios
cd "C:\ruta\a\agentes-claude"
git checkout agente-autismo
git add agente-autismo
git commit -m "Subir contenido de AUTISMO AGENT"
git push origin agente-autismo
```

## Estructura sugerida

Puedes organizar tus archivos como prefieras. Un ejemplo:

```
agente-autismo/
├── documentos/      # PDFs, notas, guías
├── recursos/        # imágenes, audios, materiales
├── codigo/          # scripts o proyectos
└── README.md        # este archivo
```
