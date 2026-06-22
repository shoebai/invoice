; ─────────────────────────────────────────────────────────────────────────────
; installer.nsh  —  Custom NSIS hooks for Aqsa Invoice installer
;
; Included automatically by electron-builder via nsis.include in package.json.
; Adds: upgrade detection, user messaging, and data-preservation logic.
; ─────────────────────────────────────────────────────────────────────────────

!macro customHeader
  !system "echo Aqsa Invoice NSIS Build"
!macroend

; ── Runs at the very start of installer init ──────────────────────────────────
!macro customInit
  ; Check if a previous version is already installed
  ReadRegStr $R0 HKCU "Software\${PRODUCT_NAME}" "InstallLocation"
  ${If} $R0 != ""
    ; Found existing installation — show upgrade notice
    MessageBox MB_ICONINFORMATION|MB_OKCANCEL \
      "A previous version of ${PRODUCT_NAME} is already installed.$\n$\nClick OK to upgrade to version ${VERSION}.$\nYour invoice data will be preserved.$\n$\nClick Cancel to exit." \
      IDOK continueUpgrade
    Quit

    continueUpgrade:
      ; Kill running instance gracefully before upgrade
      ExecWait 'taskkill /F /IM "Aqsa Invoice.exe" /T' $0
      Sleep 1000
  ${EndIf}
!macroend

; ── Runs before files are installed ──────────────────────────────────────────
!macro customInstall
  ; Write version info to registry so we can detect it next time
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"

  ; Add uninstall info to Windows Programs & Features
  WriteRegStr HKLM \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" \
    "Publisher" "Aqsa Hotels"
!macroend

; ── Runs at uninstaller init ──────────────────────────────────────────────────
!macro customUnInit
  MessageBox MB_ICONQUESTION|MB_YESNO \
    "Are you sure you want to uninstall ${PRODUCT_NAME}?$\n$\nYour invoice data stored in AppData will NOT be deleted." \
    IDYES doUninstall
  Quit

  doUninstall:
    ExecWait 'taskkill /F /IM "Aqsa Invoice.exe" /T' $0
    Sleep 500
!macroend

; ── Runs after uninstall completes ───────────────────────────────────────────
!macro customUnInstall
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  DeleteRegKey HKLM \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
!macroend
