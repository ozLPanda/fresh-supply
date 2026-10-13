; The pinned template patch invokes these macros before any old uninstall.
; Data lives in Roaming/Ovoshi Help and is never part of these directory swaps.
!macro customHeader
!ifndef BUILD_UNINSTALLER
  Var freshStage
  Var freshPrevious
  Var freshParent
  Var freshUserSid
  Var packageArch
  Var freshDataDir
!endif
!macroend

!macro freshGuardDataDirectory DATA_DIR
  GetFullPathName $freshDataDir "${DATA_DIR}"
  StrCpy $freshDataDir "$freshDataDir\"
  StrCpy $R0 "$INSTDIR\"
  StrLen $R1 $R0
  StrCpy $R2 $freshDataDir $R1
  ${if} $R2 == $R0
    !insertmacro freshInstallError "Каталог установки содержит данные приложения. Выберите отдельный каталог для программы." 28
  ${endif}
  StrLen $R1 $freshDataDir
  StrCpy $R2 $R0 $R1
  ${if} $R2 == $freshDataDir
    !insertmacro freshInstallError "Нельзя устанавливать программу в каталог её данных. Выберите другой каталог." 28
  ${endif}
!macroend

!macro freshInstallError MESSAGE CODE
  DetailPrint "${MESSAGE}"
  !insertmacro freshInstallLog "Failed (${CODE}): ${MESSAGE}"
  MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}" /SD IDOK
  SetErrorLevel ${CODE}
  Quit
!macroend

!macro freshInstallLog MESSAGE
  Push $0
  CreateDirectory "$LOCALAPPDATA\fresh-supply-desktop-updater"
  FileOpen $0 "$LOCALAPPDATA\fresh-supply-desktop-updater\installation.log" a
  ${ifNot} ${Errors}
    FileWrite $0 "${MESSAGE}$\r$\n"
    FileClose $0
  ${endif}
  Pop $0
!macroend

!macro freshPrepareInstallation
  GetFullPathName $INSTDIR "$INSTDIR"
  !insertmacro freshGuardDataDirectory "$APPDATA\Ovoshi Help"
  ${StdUtils.GetParameter} $freshDataDir "fresh-supply-data-dir" ""
  ${if} $freshDataDir != ""
    !insertmacro freshGuardDataDirectory "$freshDataDir"
  ${endif}
  !insertmacro freshInstallLog "Preparing fresh-supply ${VERSION} in $INSTDIR"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ${GetParent} "$INSTDIR" $freshParent
  ; Sibling directories keep all activation/rollback renames on one volume.
  ClearErrors
  CreateDirectory "$freshParent"
  ${if} ${Errors}
    !insertmacro freshInstallError "Нет прав на каталог установки. Запустите установщик с необходимыми правами Windows." 20
  ${endif}
  GetTempFileName $freshStage "$freshParent"
  ${if} ${Errors}
    !insertmacro freshInstallError "Не удалось подготовить обновление. Запустите установщик с необходимыми правами Windows." 20
  ${endif}
  Delete "$freshStage"
  CreateDirectory "$freshStage"
  ${if} ${Errors}
    !insertmacro freshInstallError "Не удалось создать временный каталог. Установленная программа сохранена." 21
  ${endif}
  !insertmacro identify_package
  !ifdef COMPRESS
    SetCompress off
  !endif
  !insertmacro compute_files_for_current_arch
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif
  SetOutPath "$freshStage"
  Nsis7z::Extract "$PLUGINSDIR\app-$packageArch.7z"
  SetOutPath "$PLUGINSDIR"
  File /oname=verify-install.py "${PROJECT_DIR}\installer\verify-install.py"
  ${StdUtils.GetParameter} $freshUserSid "fresh-supply-user-sid" ""
  nsExec::ExecToStack '"$freshStage\resources\runtime\python\python.exe" -I "$PLUGINSDIR\verify-install.py" "$freshStage" "${VERSION}" "$freshUserSid"'
  Pop $R0
  Pop $R1
  DetailPrint "$R1"
  !insertmacro freshInstallLog "$R1"
  ${if} $R0 != 0
    RMDir /r "$freshStage"
    !insertmacro freshInstallError "Проверка обновления не пройдена. Программа и ваши данные сохранены." 22
  ${endif}
  ; Refuse to relocate another registered installation implicitly. The updater
  ; supplies its current /D directory, and repair uses that same directory.
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R0 != ""
  ${andIf} $R0 != $INSTDIR
    RMDir /r "$freshStage"
    !insertmacro freshInstallError "Программа уже установлена в другом каталоге. Выберите его для обновления или восстановления." 23
  ${endif}
!macroend

!macro freshInstallApplicationFiles
  SetOutPath "$PLUGINSDIR"
  StrCpy $freshPrevious ""
  ${if} ${FileExists} "$INSTDIR\*.*"
    ClearErrors
    GetTempFileName $freshPrevious "$freshParent"
    ${if} ${Errors}
      RMDir /r "$freshStage"
      !insertmacro freshInstallError "Не удалось подготовить восстановление. Установленная программа сохранена." 24
    ${endif}
    Delete "$freshPrevious"
    ClearErrors
    Rename "$INSTDIR" "$freshPrevious"
    ${if} ${Errors}
      RMDir /r "$freshStage"
      !insertmacro freshInstallError "Не удалось заменить файлы. Закройте fresh-supply и повторите. Установленная программа сохранена." 25
    ${endif}
  ${else}
    ; SetOutPath in the base template can have created an empty directory.
    RMDir "$INSTDIR"
  ${endif}
  ClearErrors
  Rename "$freshStage" "$INSTDIR"
  ${if} ${Errors}
    ${if} $freshPrevious != ""
      ClearErrors
      Rename "$freshPrevious" "$INSTDIR"
      ${if} ${Errors}
        !insertmacro freshInstallError "Обновление прервано, требуется восстановление. Файлы сохранены: $freshPrevious и $freshStage. Повторите установку в прежний каталог. Данные не удалены." 29
      ${endif}
    ${endif}
    RMDir /r "$freshStage"
    !insertmacro freshInstallError "Не удалось установить обновление. Предыдущая программа восстановлена, данные сохранены." 26
  ${endif}
  SetOutPath "$INSTDIR"
  ClearErrors
  File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"
  ${ifNot} ${Errors}
    !ifdef UNINSTALLER_ICON
      File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
    !endif
  ${endif}
  ${if} ${Errors}
    SetOutPath "$PLUGINSDIR"
    ClearErrors
    Rename "$INSTDIR" "$freshStage"
    ${if} ${Errors}
      !insertmacro freshInstallError "Установка прервана, требуется восстановление. Программа сохранена в $INSTDIR, предыдущая версия в $freshPrevious. Повторите установку. Данные не удалены." 29
    ${endif}
    ${if} $freshPrevious != ""
      ClearErrors
      Rename "$freshPrevious" "$INSTDIR"
      ${if} ${Errors}
        !insertmacro freshInstallError "Установка прервана, требуется восстановление. Файлы сохранены: $freshPrevious и $freshStage. Повторите установку в прежний каталог. Данные не удалены." 29
      ${endif}
    ${endif}
    RMDir /r "$freshStage"
    !insertmacro freshInstallError "Не удалось завершить установку. Предыдущая программа восстановлена, данные сохранены." 27
  ${endif}
  ; Repair old shortcuts as well as missing shortcuts, including --updated.
  StrCpy $keepShortcuts "false"
!macroend

!macro customInstall
  !insertmacro freshInstallLog "Installed fresh-supply ${VERSION} in $INSTDIR"
  ; Registry and shortcuts have now been replaced for the complete new payload.
  ; Cleanup is best effort: a locked recovery directory must not turn a
  ; successful installation into a destructive retry.
  ${if} $freshPrevious != ""
    SetOutPath "$PLUGINSDIR"
    RMDir /r "$freshPrevious"
    SetOutPath "$INSTDIR"
  ${endif}
!macroend
