# Reduce Largest Contentful Paint (RLCP)

A powerful CLI tool to optimize images in your project, convert them to modern formats (like WebP), and automatically update file references in your code.

## Demo Video - [Here](https://github.com/user-attachments/assets/fe73e189-dd41-4628-a0aa-00546b3bbd48)


## Usage

1.  **Configuration**: Create a `rlcp.config.json` file in your project root.

    ```json
    {
    	"input": "public",
    	"output": "temp_public",
    	"blacklists": ["public/brand/**"],
    	"file_size": "small",
    	"preferred_type": "webp",
    	"working_directory": "./"
    }
    ```

2.  **Run**: Execute the tool in your project directory.

    ```bash
    bunx rlcp
    # or if installed locally
    bun start
    ```

## Configuration (`rlcp.config.json`)

| Key                 | Type     | Description                                                                 | Required |
| ------------------- | -------- | --------------------------------------------------------------------------- | :------: |
| `input`             | `string` | Directory to scan for source images.                                        |   Yes    |
| `output`            | `string` | Directory where original images will be moved (backup).                     |   Yes    |
| `blacklists`        | `array`  | Glob patterns for files/folders to ignore.                                  |    No    |
| `file_size`         | `string` | Target quality: `"small"` (80%) or `"smallest"` (60%).                      |    No    |
| `preferred_type`    | `string` | Target format: `"png"`, `"jpeg"`, `"jpg"`, or `"webp"`.                     |    No    |
| `working_directory` | `string` | Directory to scan for code files to update references (e.g., HTML, JS, TS). |    No    |

_If optional fields are omitted, the CLI will prompt you for them during execution._

## Features

### 🖼️ Image Conversion & Optimization

Converts images found in the `input` directory to your preferred format (e.g., PNG to WebP) and optimizes them based on the selected quality setting.

### 📦 Safe Backup

Original images are **not deleted**. They are moved to the specified `output` directory, preserving their original folder structure. This directory is automatically added to `.gitignore`.

### 🔄 Automatic Reference Updates

If `working_directory` is specified, Reduce Largest Contentful Paint (RLCP) scans your code files (HTML, JS, JSX, TS, TSX, CSS, JSON, MD) and automatically updates references to point to the new file extensions (e.g., changing `img.png` to `img.webp` in your `index.html`).

### 🔒 Smart Locking

Reduce Largest Contentful Paint (RLCP) creates a `rlcp.lock` file to track converted images.

- Prevents re-converting images that have already been processed.
- Ensures reference updates still work even if the original file has been moved to the backup folder.
- Detects if the converted file is missing and allows re-generation if needed.
