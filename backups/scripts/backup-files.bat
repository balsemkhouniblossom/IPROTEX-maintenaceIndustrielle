@echo off
REM GMAO Filesystem Backup Script
REM This script backs up uploads, logs, and configuration files

echo Starting filesystem backup...

REM Configuration
set BACKUP_DIR=C:\Users\Balsem\Desktop\GMAO\backups\filesystem
set SOURCE_DIR=C:\Users\Balsem\Desktop\GMAO
set DATE=%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set BACKUP_NAME=filesystem_%DATE%

REM Remove spaces from time format
set BACKUP_NAME=%BACKUP_NAME: =0%

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo Creating backup: %BACKUP_NAME%

REM Create a temporary directory for selective backup
set TEMP_BACKUP_DIR=%BACKUP_DIR%\temp_%BACKUP_NAME%
mkdir "%TEMP_BACKUP_DIR%"

REM Copy important directories (excluding node_modules, .git, etc.)
if exist "%SOURCE_DIR%\backend\uploads" xcopy "%SOURCE_DIR%\backend\uploads" "%TEMP_BACKUP_DIR%\backend\uploads\" /E /I /H /Y
if exist "%SOURCE_DIR%\frontend\public\uploads" xcopy "%SOURCE_DIR%\frontend\public\uploads" "%TEMP_BACKUP_DIR%\frontend\uploads\" /E /I /H /Y
if exist "%SOURCE_DIR%\backend\logs" xcopy "%SOURCE_DIR%\backend\logs" "%TEMP_BACKUP_DIR%\backend\logs\" /E /I /H /Y
if exist "%SOURCE_DIR%\frontend\logs" xcopy "%SOURCE_DIR%\frontend\logs" "%TEMP_BACKUP_DIR%\frontend\logs\" /E /I /H /Y

REM Copy configuration files
if exist "%SOURCE_DIR%\backend\.env" copy "%SOURCE_DIR%\backend\.env" "%TEMP_BACKUP_DIR%\backend\.env"
if exist "%SOURCE_DIR%\frontend\.env.local" copy "%SOURCE_DIR%\frontend\.env.local" "%TEMP_BACKUP_DIR%\frontend\.env.local"

REM Compress the backup
powershell "Compress-Archive -Path '%TEMP_BACKUP_DIR%' -DestinationPath '%BACKUP_DIR%\%BACKUP_NAME%.zip' -Force"

REM Remove temporary directory
rmdir /s /q "%TEMP_BACKUP_DIR%"

REM Check if backup was successful
if %errorlevel% equ 0 (
    echo Backup completed successfully: %BACKUP_DIR%\%BACKUP_NAME%.zip

    REM Clean up old backups (keep last 30 days)
    echo Cleaning up old backups...
    forfiles /p "%BACKUP_DIR%" /m "*.zip" /d -30 /c "cmd /c del @path" 2>nul || echo No old backups to clean up.

    echo Filesystem backup process completed!
    exit /b 0

) else (
    echo ERROR: Filesystem backup failed!
    exit /b 1
)