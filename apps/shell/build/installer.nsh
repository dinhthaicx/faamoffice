; Keeps the faamoffice command line (resources\cli, holding faamoffice.cmd and the
; extension-less faamoffice for Git Bash) on the installing user's PATH for the
; lifetime of the install. The value is read and written unexpanded
; (REG_EXPAND_SZ) so entries such as %USERPROFILE%\bin survive, and Explorer
; is told about the change so terminals opened afterwards see it.
; electron-builder compiles the script twice (the second pass, with
; BUILD_UNINSTALLER, only produces the uninstaller); an unreferenced function
; in either pass is a warning makensis treats as an error, hence the guards.
!include "WinMessages.nsh"
!include "StrFunc.nsh"

!define GENOFFICE_PATH_MAX 7900

; Scope templates to our ProgIDs (electron-builder uses fileAssociations.name).
; A shared .ext\ShellNew would overwrite Office/WPS templates. OOXML files
; must be copied from valid packages, never created with NullFile.
!macro GenOfficeRegisterShellNew EXT PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName" "$INSTDIR\resources\shell-new\blank.${EXT}"
!macroend

!macro GenOfficeUnregisterShellNew EXT PROGID
  ; Only remove our own registration, including when uninstalling for an update.
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName"
  ${If} $0 == "$INSTDIR\resources\shell-new\blank.${EXT}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}"
  ${EndIf}
!macroend

; Default Programs registration. Windows apps cannot make themselves the
; default; they can only appear in Settings > Default apps, which lists the
; apps named under Software\RegisteredApplications and offers each one the
; extensions in its Capabilities\FileAssociations. Both keys go to the
; install's own hive (SHELL_CONTEXT: HKCU per-user, HKLM per-machine); Windows
; resolves the RegisteredApplications path inside that same hive, and the app
; deep-links to its page with registeredAppUser / registeredAppMachine
; accordingly (src/main/default-app.ts). PRODUCT_NAME is electron-builder's
; productName define.
!define GENOFFICE_CAPABILITIES_KEY "Software\${PRODUCT_NAME}\Capabilities"

; Values are the ProgIds electron-builder's APP_ASSOCIATE writes
; (fileAssociations[].name in electron-builder.cjs); every association needs
; a line here, checked by tests/installer-capabilities.test.ts.
!macro GenOfficeCapabilityFileAssoc EXT PROGID
  WriteRegStr SHELL_CONTEXT "${GENOFFICE_CAPABILITIES_KEY}\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro GenOfficeRegisterCapabilities
  WriteRegStr SHELL_CONTEXT "${GENOFFICE_CAPABILITIES_KEY}" "ApplicationName" "${PRODUCT_NAME}"
  ; package.json's description is developer-facing, so this one is our own
  WriteRegStr SHELL_CONTEXT "${GENOFFICE_CAPABILITIES_KEY}" "ApplicationDescription" "Edit Word, Excel, PowerPoint, PDF, Markdown and HTML documents."
  WriteRegStr SHELL_CONTEXT "${GENOFFICE_CAPABILITIES_KEY}" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  !insertmacro GenOfficeCapabilityFileAssoc "docx" "Word Document"
  !insertmacro GenOfficeCapabilityFileAssoc "doc" "Word 97-2003 Document"
  !insertmacro GenOfficeCapabilityFileAssoc "xlsx" "Excel Workbook"
  !insertmacro GenOfficeCapabilityFileAssoc "xlsm" "Excel Macro-Enabled Workbook"
  !insertmacro GenOfficeCapabilityFileAssoc "pptx" "PowerPoint Presentation"
  !insertmacro GenOfficeCapabilityFileAssoc "xls" "Excel 97-2003 Workbook"
  !insertmacro GenOfficeCapabilityFileAssoc "csv" "CSV Document"
  !insertmacro GenOfficeCapabilityFileAssoc "tsv" "TSV Document"
  !insertmacro GenOfficeCapabilityFileAssoc "pdf" "PDF Document"
  !insertmacro GenOfficeCapabilityFileAssoc "md" "Markdown Document"
  !insertmacro GenOfficeCapabilityFileAssoc "markdown" "Markdown Document"
  !insertmacro GenOfficeCapabilityFileAssoc "html" "HTML Document"
  !insertmacro GenOfficeCapabilityFileAssoc "htm" "HTML Document"
  ; last, so Windows never sees the app listed before its capabilities exist
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${GENOFFICE_CAPABILITIES_KEY}"
!macroend

; Inserted only by un.onUninstSuccess (below), never by customUnInstall:
; customUnInstall runs before the template removes the files, and when the
; next version's installer uninstalls this one for an update, a locked file
; makes the template restore the files and Abort; that installer then quits
; without registering again, so unregistering there would drop the
; still-installed app from Default apps. Clobbers $0. Plain StrCmp: a
; function body is compiled where this file is included, and LogicLib is only
; there through StrFunc.nsh, ahead of electron-builder's own include.
!macro GenOfficeUnregisterCapabilities
  ; another app may own a value of the same name: only drop it while it is ours
  ReadRegStr $0 SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
  StrCmp $0 "${GENOFFICE_CAPABILITIES_KEY}" 0 +2
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey SHELL_CONTEXT "${GENOFFICE_CAPABILITIES_KEY}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\${PRODUCT_NAME}"
!macroend

!macro customInstall
  Push "$INSTDIR\resources\cli"
  Call GenOfficeAddToUserPath
  !insertmacro GenOfficeRegisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeRegisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeRegisterShellNew "pptx" "PowerPoint Presentation"
  !insertmacro GenOfficeRegisterCapabilities
  ; one shell notification covers the ProgIds, ShellNew and Default Programs
  !insertmacro UPDATEFILEASSOC
!macroend

; The PATH entry and ShellNew templates are still removed here, so the failed
; update described above loses them too (until the next successful install).
; The Default Programs registration is removed by un.onUninstSuccess instead.
!macro customUnInstall
  Push "$INSTDIR\resources\cli"
  Call un.GenOfficeRemoveFromUserPath
  Push $0
  !insertmacro GenOfficeUnregisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeUnregisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeUnregisterShellNew "pptx" "PowerPoint Presentation"
  Pop $0
  ; the open-at-login entry the app writes (login-item.ts WINDOWS_RUN_VALUE_NAME
  ; = productName); an update keeps it, only a real uninstall removes it
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCT_NAME}"
  ${endIf}
  !insertmacro UPDATEFILEASSOC
!macroend

!ifndef BUILD_UNINSTALLER
${StrStr}

Function GenOfficeAddToUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  Push $3
  ReadRegStr $1 HKCU "Environment" "Path"
  StrLen $2 $1
  ; leave an already oversized PATH alone rather than truncate it
  IntCmp $2 ${GENOFFICE_PATH_MAX} done 0 done
  ${StrStr} $3 ";$1;" ";$0;"
  StrCmp $3 "" 0 done
  StrCmp $1 "" 0 +3
    StrCpy $1 "$0"
    Goto write
  StrCpy $1 "$1;$0"
write:
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
${UnStrStr}
${UnStrRep}

Function un.GenOfficeRemoveFromUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" done
  ${UnStrStr} $2 ";$1;" ";$0;"
  StrCmp $2 "" done
  StrCpy $1 ";$1;"
  ${UnStrRep} $1 $1 ";$0;" ";"
  ; strip the sentinels added above
  StrCpy $1 $1 -1
  StrCpy $1 $1 "" 1
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; NSIS calls this only when no uninstall section aborted: when the interactive
; uninstaller's last page is left, or at the end of a silent run (the update
; path runs this uninstaller with /S). It runs inside this process, so it
; finishes before ExecWait returns to the next installer and that installer's
; customInstall registers again. electron-builder's templates define no
; un.onUninstSuccess. SHELL_CONTEXT and the registry view are as un.onInit
; set them.
Function un.onUninstSuccess
  Push $0
  !insertmacro GenOfficeUnregisterCapabilities
  Pop $0
  ; SHCNE_ASSOCCHANGED, SHCNF_FLUSH: FileAssociation.nsh, which defines them,
  ; is included after this file
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
FunctionEnd
!endif
