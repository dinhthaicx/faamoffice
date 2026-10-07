import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { installResumeDownload } from './update-resume'
import { isStoreInstall, openStorePage, storeListing } from './ms-store'
import { downloadMacDmg, feedFileName, pickMacDmg } from './update-dmg'
import type { UpdateInfo } from 'electron-updater'
import { createI18n, getUiLang, htmlLang } from '@genoffice/i18n'
import type {
  UpdateChannel,
  UpdateFlow,
  UpdatePhase,
  UpdateUiState,
  UpdateUiStrings,
} from '../shared/update-api'
import {
  closeUpdateWindow,
  isUpdateWindowOpen,
  pushUpdateState,
  rememberUpdate,
  showUpdateWindow,
  whenUpdatePromptAllowed,
} from './update-window'

/**
 * Update notifications and downloads, fed by the project's GitHub Releases.
 *
 * Feed: electron-updater's generic provider at
 * https://github.com/<repo>/releases/latest/download — GitHub redirects that
 * prefix to the newest published, non-prerelease release, which carries
 * latest.yml (Windows), latest-mac.yml and latest-linux.yml. The URL is baked
 * into resources/app-update.yml from GENOFFICE_UPDATE_URL (see
 * apps/shell/electron-builder.cjs); release.yml sets it for v* tag builds only,
 * and scripts/release-feed.cjs pins every file the feeds list to its tag
 * (…/releases/download/<tag>/<file>) before the release goes public. Builds
 * without a feed (dev runs, manual workflow runs, local packaging, 0.11.1 and
 * older) never check; Help → Check for Updates points them at the download
 * page instead.
 *
 * Flows (UpdateFlow):
 * - install — Windows NSIS and Linux AppImage: electron-updater downloads the
 *   full installer (Range-resumable, update-resume.ts) and "Restart & Install"
 *   applies it.
 * - notify, macOS — the builds are ad-hoc signed, which Squirrel.Mac refuses
 *   to install over, so electron-updater only checks: the card's action
 *   downloads the dmg for this Mac from latest-mac.yml, verifies its sha512
 *   and opens it (update-dmg.ts); the user quits and drags FaamOffice into
 *   Applications. Any failure opens the tag-pinned dmg (else the download
 *   page) in the browser.
 * - notify, Linux deb/rpm (resources/package-type; dpkg's file list tells the
 *   two apart, see linuxPackageType) — the card opens the release's package
 *   for that format in the browser.
 *
 * Microsoft Store installs (ms-store.ts) never start electron-updater: the
 * Store updates the package, and Help → Check for Updates says so and offers
 * the listing.
 *
 * Nagging: the automatic card shows a given version at most once a day
 * (UPDATE_PROMPT_KEY in app-settings) and waits while onboarding or an
 * announcement is on screen (update-window.ts). Help → Check for Updates and
 * Settings → About always show it. FAAMOFFICE_UPDATES=0 turns every check off.
 * There is no beta feed: the Beta channel reads latest.yml as well.
 *
 * UX is the strong-guidance card (update-window.ts), not a native dialog.
 *
 * Dev preview: GENOFFICE_FAKE_UPDATE=<version> in an unpacked run opens the
 * window with a simulated download so the UI can be exercised end to end.
 *
 * Testing the real flow locally (macOS shown; Windows/Linux work the same with
 * latest.yml / latest-linux.yml). A feed URL may be plain http only on a
 * loopback host:
 *   1. Package an app that reads a local feed:
 *        GENOFFICE_UPDATE_URL=http://127.0.0.1:8765 npm run dist:mac -w @genoffice/shell
 *      and install apps/shell/release/FaamOffice-<v>-arm64.dmg.
 *   2. Make a "newer" release to serve: bump apps/shell/package.json to a
 *      higher version and package again into another directory with
 *        BUILD_DIR=release-next GENOFFICE_UPDATE_URL=http://127.0.0.1:8765 npm run dist:mac -w @genoffice/shell
 *      (apps/shell/release-next/ then holds latest-mac.yml and the dmgs). Or
 *      hand-write a latest-mac.yml next to any dmg:
 *        version: 9.9.9
 *        files:
 *          - url: FaamOffice-9.9.9-arm64.dmg
 *            sha512: <shasum -a 512 FaamOffice-9.9.9-arm64.dmg | cut -d' ' -f1 | xxd -r -p | base64>
 *        path: FaamOffice-9.9.9-arm64.dmg
 *   3. Serve that directory: python3 -m http.server 8765 -d apps/shell/release-next
 *   4. Launch the installed app: about 15 s later the card offers the new
 *      version (or use Help → Check for Updates). Corrupt the served dmg to
 *      exercise the browser fallback.
 */

const tUpd = createI18n({
  zh: {
    updTitle: '软件更新',
    updHeadline: '发现新版本',
    updDesc: '新版本包含性能改进与问题修复，建议立即更新。',
    updDownload: '立即更新',
    updLater: '最小化',
    updInstall: '立即重启安装',
    updDownloading: '正在下载更新…',
    updFailed: '更新下载失败，请检查网络后重试。',
    updRetry: '重试',
    updManual: '自动更新失败，请从下载页面获取最新版本并手动安装。',
    updUpToDate: '已是最新版本（{version}）。',
    updCheckFailed: '无法检查更新，请检查网络后重试。',
    updOpenDownload: '前往下载页面',
    updNoFeed: '此版本不会自动检查更新，请从下载页面获取最新版本。',
    updNotifyDesc:
      '新版本安装包将下载并自动打开。随后请退出 FaamOffice，并将 FaamOffice 拖到“应用程序”文件夹中替换旧版本。',
    updNotifyDescPkg: '请下载新的安装包并安装，以更新 FaamOffice。',
    updDownloadPackage: '下载安装包',
    updReady:
      '安装包已打开。请退出 FaamOffice，然后将 FaamOffice 拖到“应用程序”文件夹并选择“替换”。',
    updQuitApp: '退出 FaamOffice',
    updBrowserFallback:
      '无法在应用内下载更新，已在浏览器中打开下载链接。请打开下载的文件，退出 FaamOffice，然后将 FaamOffice 拖到“应用程序”文件夹。',
    updStore: '来自 Microsoft Store 的 FaamOffice 由 Microsoft Store 自动更新。',
    updOpenStore: '打开 Microsoft Store',
  },
  en: {
    updTitle: 'Software Update',
    updHeadline: 'A new version is available',
    updDesc:
      'This update includes performance improvements and bug fixes. We recommend updating now.',
    updDownload: 'Update Now',
    updLater: 'Minimize',
    updInstall: 'Restart & Install',
    updDownloading: 'Downloading update…',
    updFailed: 'Update download failed. Check your network and try again.',
    updRetry: 'Retry',
    updManual:
      'Automatic update failed. Please get the latest version from the download page and install it manually.',
    updUpToDate: "You're up to date (version {version}).",
    updCheckFailed: "Couldn't check for updates. Check your network and try again.",
    updOpenDownload: 'Open Download Page',
    updNoFeed:
      "This build doesn't check for updates automatically. Get the latest version from the download page.",
    updNotifyDesc:
      'The new version will be downloaded and opened. Then quit FaamOffice and drag FaamOffice into the Applications folder to replace the old version.',
    updNotifyDescPkg: 'Download the new installation package and install it to update FaamOffice.',
    updDownloadPackage: 'Download Package',
    updReady:
      'The installer is open. Quit FaamOffice, then drag FaamOffice into the Applications folder and choose Replace.',
    updQuitApp: 'Quit FaamOffice',
    updBrowserFallback:
      "The update couldn't be downloaded in the app, so it was opened in your browser. Open the downloaded file, quit FaamOffice, and drag FaamOffice into the Applications folder.",
    updStore: 'FaamOffice from Microsoft Store is updated automatically by the Store.',
    updOpenStore: 'Open Microsoft Store',
  },
  vi: {
    updTitle: 'Cập nhật phần mềm',
    updHeadline: 'Đã có phiên bản mới',
    updDesc:
      'Bản cập nhật này bao gồm các cải tiến hiệu suất và sửa lỗi. Chúng tôi khuyên bạn nên cập nhật ngay bây giờ.',
    updDownload: 'Cập nhật ngay',
    updLater: 'Thu nhỏ',
    updInstall: 'Khởi động lại & Cài đặt',
    updDownloading: 'Đang tải xuống bản cập nhật…',
    updFailed: 'Tải xuống bản cập nhật thất bại. Kiểm tra mạng của bạn và thử lại.',
    updRetry: 'Thử lại',
    updManual:
      'Cập nhật tự động thất bại. Vui lòng lấy phiên bản mới nhất từ trang tải xuống và cài đặt thủ công.',
    updUpToDate: 'Bạn đang sử dụng phiên bản mới nhất (phiên bản {version}).',
    updCheckFailed: 'Không thể kiểm tra bản cập nhật. Kiểm tra mạng của bạn và thử lại.',
    updOpenDownload: 'Mở trang tải xuống',
    updNoFeed:
      'Bản FaamOffice này không tự động kiểm tra cập nhật. Hãy tải phiên bản mới nhất từ trang tải xuống.',
    updNotifyDesc:
      'Bản cài đặt mới sẽ được tải về và tự mở. Sau đó, hãy thoát FaamOffice rồi kéo FaamOffice vào thư mục Ứng dụng (Applications) để thay thế bản cũ.',
    updNotifyDescPkg: 'Hãy tải gói cài đặt mới và cài đặt để cập nhật FaamOffice.',
    updDownloadPackage: 'Tải gói cài đặt',
    updReady:
      'Bản cài đặt đã được mở. Hãy thoát FaamOffice, sau đó kéo FaamOffice vào thư mục Ứng dụng (Applications) và chọn Thay thế.',
    updQuitApp: 'Thoát FaamOffice',
    updBrowserFallback:
      'Không thể tải bản cập nhật ngay trong ứng dụng nên liên kết tải đã được mở trong trình duyệt. Hãy mở tệp vừa tải, thoát FaamOffice rồi kéo FaamOffice vào thư mục Ứng dụng (Applications).',
    updStore: 'FaamOffice cài từ Microsoft Store được Microsoft Store tự động cập nhật.',
    updOpenStore: 'Mở Microsoft Store',
  },
  ja: {
    updTitle: 'ソフトウェアアップデート',
    updHeadline: '新しいバージョンがあります',
    updDesc:
      'このアップデートにはパフォーマンス改善とバグ修正が含まれます。今すぐの更新をおすすめします。',
    updDownload: '今すぐ更新',
    updLater: '最小化',
    updInstall: '再起動してインストール',
    updDownloading: 'アップデートをダウンロード中…',
    updFailed: 'ダウンロードに失敗しました。ネットワークを確認して再試行してください。',
    updRetry: '再試行',
    updManual:
      '自動更新に失敗しました。ダウンロードページから最新バージョンを取得して手動でインストールしてください。',
    updUpToDate: '最新の状態です（バージョン {version}）。',
    updCheckFailed: '更新を確認できませんでした。ネットワークを確認して再試行してください。',
    updOpenDownload: 'ダウンロードページを開く',
    updNoFeed:
      'このビルドは自動でアップデートを確認しません。ダウンロードページから最新バージョンを入手してください。',
    updNotifyDesc:
      '新しいバージョンをダウンロードして開きます。その後 FaamOffice を終了し、FaamOffice を「アプリケーション」フォルダにドラッグして古いバージョンを置き換えてください。',
    updNotifyDescPkg:
      '新しいインストールパッケージをダウンロードしてインストールし、FaamOffice をアップデートしてください。',
    updDownloadPackage: 'パッケージをダウンロード',
    updReady:
      'インストーラを開きました。FaamOffice を終了してから、FaamOffice を「アプリケーション」フォルダにドラッグし、「置き換える」を選んでください。',
    updQuitApp: 'FaamOffice を終了',
    updBrowserFallback:
      'アプリ内でアップデートをダウンロードできなかったため、ブラウザで開きました。ダウンロードしたファイルを開き、FaamOffice を終了してから FaamOffice を「アプリケーション」フォルダにドラッグしてください。',
    updStore: 'Microsoft Store 版の FaamOffice は、Microsoft Store によって自動的に更新されます。',
    updOpenStore: 'Microsoft Store を開く',
  },
  ko: {
    updTitle: '소프트웨어 업데이트',
    updHeadline: '새 버전이 있습니다',
    updDesc:
      '이 업데이트에는 성능 개선과 버그 수정이 포함되어 있습니다. 지금 업데이트하는 것을 권장합니다.',
    updDownload: '지금 업데이트',
    updLater: '최소화',
    updInstall: '다시 시작 및 설치',
    updDownloading: '업데이트 다운로드 중…',
    updFailed: '업데이트 다운로드에 실패했습니다. 네트워크를 확인한 후 다시 시도하세요.',
    updRetry: '다시 시도',
    updManual:
      '자동 업데이트에 실패했습니다. 다운로드 페이지에서 최신 버전을 받아 직접 설치해 주세요.',
    updUpToDate: '최신 버전입니다 (버전 {version}).',
    updCheckFailed: '업데이트를 확인할 수 없습니다. 네트워크를 확인한 후 다시 시도하세요.',
    updOpenDownload: '다운로드 페이지 열기',
    updNoFeed:
      '이 빌드는 업데이트를 자동으로 확인하지 않습니다. 다운로드 페이지에서 최신 버전을 받으세요.',
    updNotifyDesc:
      '새 버전을 다운로드한 뒤 엽니다. 그런 다음 FaamOffice를 종료하고 FaamOffice를 응용 프로그램 폴더로 드래그하여 이전 버전을 대치하세요.',
    updNotifyDescPkg: '새 설치 패키지를 다운로드하고 설치하여 FaamOffice를 업데이트하세요.',
    updDownloadPackage: '패키지 다운로드',
    updReady:
      '설치 프로그램이 열렸습니다. FaamOffice를 종료한 다음 FaamOffice를 응용 프로그램 폴더로 드래그하고 대치를 선택하세요.',
    updQuitApp: 'FaamOffice 종료',
    updBrowserFallback:
      '앱에서 업데이트를 다운로드할 수 없어 브라우저에서 열었습니다. 다운로드한 파일을 열고 FaamOffice를 종료한 다음 FaamOffice를 응용 프로그램 폴더로 드래그하세요.',
    updStore: 'Microsoft Store에서 설치한 FaamOffice는 Microsoft Store가 자동으로 업데이트합니다.',
    updOpenStore: 'Microsoft Store 열기',
  },
  fr: {
    updTitle: 'Mise à jour logicielle',
    updHeadline: 'Une nouvelle version est disponible',
    updDesc:
      'Cette mise à jour apporte des améliorations de performances et des corrections de bogues. Nous vous recommandons de mettre à jour maintenant.',
    updDownload: 'Mettre à jour',
    updLater: 'Réduire',
    updInstall: 'Redémarrer et installer',
    updDownloading: 'Téléchargement de la mise à jour…',
    updFailed: 'Échec du téléchargement. Vérifiez votre réseau et réessayez.',
    updRetry: 'Réessayer',
    updManual:
      'La mise à jour automatique a échoué. Téléchargez la dernière version depuis la page de téléchargement et installez-la manuellement.',
    updUpToDate: 'Vous êtes à jour (version {version}).',
    updCheckFailed:
      'Impossible de rechercher les mises à jour. Vérifiez votre réseau et réessayez.',
    updOpenDownload: 'Ouvrir la page de téléchargement',
    updNoFeed:
      'Cette version ne recherche pas automatiquement les mises à jour. Téléchargez la dernière version depuis la page de téléchargement.',
    updNotifyDesc:
      "La nouvelle version sera téléchargée puis ouverte. Quittez ensuite FaamOffice et faites glisser FaamOffice dans le dossier Applications pour remplacer l'ancienne version.",
    updNotifyDescPkg:
      "Téléchargez le nouveau paquet d'installation et installez-le pour mettre à jour FaamOffice.",
    updDownloadPackage: 'Télécharger le paquet',
    updReady:
      "Le programme d'installation est ouvert. Quittez FaamOffice, puis faites glisser FaamOffice dans le dossier Applications et choisissez Remplacer.",
    updQuitApp: 'Quitter FaamOffice',
    updBrowserFallback:
      "La mise à jour n'a pas pu être téléchargée dans l'application, elle a donc été ouverte dans votre navigateur. Ouvrez le fichier téléchargé, quittez FaamOffice et faites glisser FaamOffice dans le dossier Applications.",
    updStore:
      'FaamOffice installé depuis le Microsoft Store est mis à jour automatiquement par le Store.',
    updOpenStore: 'Ouvrir le Microsoft Store',
  },
  de: {
    updTitle: 'Softwareaktualisierung',
    updHeadline: 'Eine neue Version ist verfügbar',
    updDesc:
      'Dieses Update enthält Leistungsverbesserungen und Fehlerbehebungen. Wir empfehlen, jetzt zu aktualisieren.',
    updDownload: 'Jetzt aktualisieren',
    updLater: 'Minimieren',
    updInstall: 'Neu starten und installieren',
    updDownloading: 'Update wird heruntergeladen…',
    updFailed:
      'Download fehlgeschlagen. Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut.',
    updRetry: 'Erneut versuchen',
    updManual:
      'Automatisches Update fehlgeschlagen. Laden Sie die neueste Version von der Download-Seite herunter und installieren Sie sie manuell.',
    updUpToDate: 'Sie sind auf dem neuesten Stand (Version {version}).',
    updCheckFailed:
      'Updates konnten nicht geprüft werden. Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut.',
    updOpenDownload: 'Download-Seite öffnen',
    updNoFeed:
      'Diese Version sucht nicht automatisch nach Updates. Laden Sie die neueste Version von der Download-Seite herunter.',
    updNotifyDesc:
      'Die neue Version wird heruntergeladen und geöffnet. Beenden Sie danach FaamOffice und ziehen Sie FaamOffice in den Ordner „Programme“, um die alte Version zu ersetzen.',
    updNotifyDescPkg:
      'Laden Sie das neue Installationspaket herunter und installieren Sie es, um FaamOffice zu aktualisieren.',
    updDownloadPackage: 'Paket herunterladen',
    updReady:
      'Das Installationsprogramm ist geöffnet. Beenden Sie FaamOffice, ziehen Sie dann FaamOffice in den Ordner „Programme“ und wählen Sie „Ersetzen“.',
    updQuitApp: 'FaamOffice beenden',
    updBrowserFallback:
      'Das Update konnte nicht in der App heruntergeladen werden und wurde daher im Browser geöffnet. Öffnen Sie die heruntergeladene Datei, beenden Sie FaamOffice und ziehen Sie FaamOffice in den Ordner „Programme“.',
    updStore: 'FaamOffice aus dem Microsoft Store wird automatisch vom Store aktualisiert.',
    updOpenStore: 'Microsoft Store öffnen',
  },
  es: {
    updTitle: 'Actualización de software',
    updHeadline: 'Hay una nueva versión disponible',
    updDesc:
      'Esta actualización incluye mejoras de rendimiento y correcciones de errores. Recomendamos actualizar ahora.',
    updDownload: 'Actualizar ahora',
    updLater: 'Minimizar',
    updInstall: 'Reiniciar e instalar',
    updDownloading: 'Descargando la actualización…',
    updFailed: 'Error al descargar. Compruebe su red e inténtelo de nuevo.',
    updRetry: 'Reintentar',
    updManual:
      'La actualización automática falló. Descargue la última versión desde la página de descargas e instálela manualmente.',
    updUpToDate: 'Está actualizado (versión {version}).',
    updCheckFailed: 'No se pudo buscar actualizaciones. Compruebe su red e inténtelo de nuevo.',
    updOpenDownload: 'Abrir página de descargas',
    updNoFeed:
      'Esta versión no busca actualizaciones automáticamente. Descargue la última versión desde la página de descargas.',
    updNotifyDesc:
      'La nueva versión se descargará y se abrirá. Después, salga de FaamOffice y arrastre FaamOffice a la carpeta Aplicaciones para reemplazar la versión anterior.',
    updNotifyDescPkg:
      'Descargue el nuevo paquete de instalación e instálelo para actualizar FaamOffice.',
    updDownloadPackage: 'Descargar paquete',
    updReady:
      'El instalador está abierto. Salga de FaamOffice, arrastre FaamOffice a la carpeta Aplicaciones y elija Reemplazar.',
    updQuitApp: 'Salir de FaamOffice',
    updBrowserFallback:
      'No se pudo descargar la actualización en la aplicación, así que se abrió en su navegador. Abra el archivo descargado, salga de FaamOffice y arrastre FaamOffice a la carpeta Aplicaciones.',
    updStore: 'FaamOffice de Microsoft Store se actualiza automáticamente desde la Store.',
    updOpenStore: 'Abrir Microsoft Store',
  },
  th: {
    updTitle: 'อัปเดตซอฟต์แวร์',
    updHeadline: 'มีเวอร์ชันใหม่พร้อมใช้งาน',
    updDesc: 'การอัปเดตนี้มีการปรับปรุงประสิทธิภาพและแก้ไขข้อบกพร่อง แนะนำให้อัปเดตทันที',
    updDownload: 'อัปเดตเลย',
    updLater: 'ย่อเก็บ',
    updInstall: 'รีสตาร์ทและติดตั้ง',
    updDownloading: 'กำลังดาวน์โหลดอัปเดต…',
    updFailed: 'ดาวน์โหลดไม่สำเร็จ โปรดตรวจสอบเครือข่ายแล้วลองอีกครั้ง',
    updRetry: 'ลองอีกครั้ง',
    updManual:
      'การอัปเดตอัตโนมัติล้มเหลว โปรดดาวน์โหลดเวอร์ชันล่าสุดจากหน้าดาวน์โหลดแล้วติดตั้งด้วยตนเอง',
    updUpToDate: 'คุณใช้เวอร์ชันล่าสุดแล้ว (เวอร์ชัน {version})',
    updCheckFailed: 'ไม่สามารถตรวจหาการอัปเดตได้ โปรดตรวจสอบเครือข่ายแล้วลองอีกครั้ง',
    updOpenDownload: 'เปิดหน้าดาวน์โหลด',
    updNoFeed: 'บิลด์นี้ไม่ตรวจหาการอัปเดตโดยอัตโนมัติ โปรดดาวน์โหลดเวอร์ชันล่าสุดจากหน้าดาวน์โหลด',
    updNotifyDesc:
      'ระบบจะดาวน์โหลดและเปิดเวอร์ชันใหม่ให้ จากนั้นให้ออกจาก FaamOffice แล้วลาก FaamOffice ไปไว้ในโฟลเดอร์แอปพลิเคชันเพื่อแทนที่เวอร์ชันเก่า',
    updNotifyDescPkg: 'โปรดดาวน์โหลดแพ็กเกจติดตั้งใหม่แล้วติดตั้งเพื่ออัปเดต FaamOffice',
    updDownloadPackage: 'ดาวน์โหลดแพ็กเกจ',
    updReady:
      'เปิดตัวติดตั้งแล้ว โปรดออกจาก FaamOffice จากนั้นลาก FaamOffice ไปไว้ในโฟลเดอร์แอปพลิเคชันแล้วเลือก “แทนที่”',
    updQuitApp: 'ออกจาก FaamOffice',
    updBrowserFallback:
      'ไม่สามารถดาวน์โหลดอัปเดตภายในแอปได้ จึงเปิดในเบราว์เซอร์แทน โปรดเปิดไฟล์ที่ดาวน์โหลด ออกจาก FaamOffice แล้วลาก FaamOffice ไปไว้ในโฟลเดอร์แอปพลิเคชัน',
    updStore: 'FaamOffice จาก Microsoft Store จะได้รับการอัปเดตโดยอัตโนมัติผ่าน Microsoft Store',
    updOpenStore: 'เปิด Microsoft Store',
  },
  id: {
    updTitle: 'Pembaruan Perangkat Lunak',
    updHeadline: 'Versi baru tersedia',
    updDesc:
      'Pembaruan ini mencakup peningkatan kinerja dan perbaikan bug. Kami menyarankan untuk memperbarui sekarang.',
    updDownload: 'Perbarui Sekarang',
    updLater: 'Minimalkan',
    updInstall: 'Mulai Ulang & Pasang',
    updDownloading: 'Mengunduh pembaruan…',
    updFailed: 'Unduhan gagal. Periksa jaringan Anda dan coba lagi.',
    updRetry: 'Coba Lagi',
    updManual:
      'Pembaruan otomatis gagal. Silakan unduh versi terbaru dari halaman unduhan dan pasang secara manual.',
    updUpToDate: 'Sudah versi terbaru (versi {version}).',
    updCheckFailed: 'Tidak dapat memeriksa pembaruan. Periksa jaringan Anda dan coba lagi.',
    updOpenDownload: 'Buka Halaman Unduhan',
    updNoFeed:
      'Build ini tidak memeriksa pembaruan secara otomatis. Unduh versi terbaru dari halaman unduhan.',
    updNotifyDesc:
      'Versi baru akan diunduh lalu dibuka. Setelah itu, keluar dari FaamOffice dan seret FaamOffice ke folder Aplikasi untuk menggantikan versi lama.',
    updNotifyDescPkg: 'Unduh paket instalasi baru lalu pasang untuk memperbarui FaamOffice.',
    updDownloadPackage: 'Unduh Paket',
    updReady:
      'Penginstal sudah terbuka. Keluar dari FaamOffice, lalu seret FaamOffice ke folder Aplikasi dan pilih Ganti.',
    updQuitApp: 'Keluar dari FaamOffice',
    updBrowserFallback:
      'Pembaruan tidak dapat diunduh di dalam aplikasi, jadi dibuka di browser Anda. Buka file yang diunduh, keluar dari FaamOffice, lalu seret FaamOffice ke folder Aplikasi.',
    updStore: 'FaamOffice dari Microsoft Store diperbarui secara otomatis oleh Store.',
    updOpenStore: 'Buka Microsoft Store',
  },
  ru: {
    updTitle: 'Обновление программы',
    updHeadline: 'Доступна новая версия',
    updDesc:
      'Это обновление содержит улучшения производительности и исправления ошибок. Рекомендуем обновиться сейчас.',
    updDownload: 'Обновить сейчас',
    updLater: 'Свернуть',
    updInstall: 'Перезапустить и установить',
    updDownloading: 'Загрузка обновления…',
    updFailed: 'Не удалось загрузить обновление. Проверьте сеть и повторите попытку.',
    updRetry: 'Повторить',
    updManual:
      'Автоматическое обновление не удалось. Скачайте последнюю версию со страницы загрузки и установите её вручную.',
    updUpToDate: 'У вас последняя версия ({version}).',
    updCheckFailed: 'Не удалось проверить обновления. Проверьте сеть и повторите попытку.',
    updOpenDownload: 'Открыть страницу загрузки',
    updNoFeed:
      'Эта сборка не проверяет обновления автоматически. Скачайте последнюю версию со страницы загрузки.',
    updNotifyDesc:
      'Новая версия будет загружена и открыта. Затем завершите FaamOffice и перетащите FaamOffice в папку «Программы», чтобы заменить старую версию.',
    updNotifyDescPkg:
      'Скачайте новый установочный пакет и установите его, чтобы обновить FaamOffice.',
    updDownloadPackage: 'Скачать пакет',
    updReady:
      'Установщик открыт. Завершите FaamOffice, затем перетащите FaamOffice в папку «Программы» и выберите «Заменить».',
    updQuitApp: 'Завершить FaamOffice',
    updBrowserFallback:
      'Не удалось загрузить обновление в приложении, поэтому оно открыто в браузере. Откройте загруженный файл, завершите FaamOffice и перетащите FaamOffice в папку «Программы».',
    updStore: 'FaamOffice из Microsoft Store обновляется автоматически через Store.',
    updOpenStore: 'Открыть Microsoft Store',
  },
  ar: {
    updTitle: 'تحديث البرنامج',
    updHeadline: 'يتوفر إصدار جديد',
    updDesc: 'يتضمن هذا التحديث تحسينات في الأداء وإصلاحات للأخطاء. نوصي بالتحديث الآن.',
    updDownload: 'التحديث الآن',
    updLater: 'تصغير',
    updInstall: 'إعادة التشغيل والتثبيت',
    updDownloading: 'جارٍ تنزيل التحديث…',
    updFailed: 'فشل تنزيل التحديث. تحقق من الشبكة وحاول مرة أخرى.',
    updRetry: 'إعادة المحاولة',
    updManual: 'فشل التحديث التلقائي. يرجى تنزيل أحدث إصدار من صفحة التنزيل وتثبيته يدويًا.',
    updUpToDate: 'أنت على أحدث إصدار (الإصدار {version}).',
    updCheckFailed: 'تعذر التحقق من التحديثات. تحقق من الشبكة وحاول مرة أخرى.',
    updOpenDownload: 'فتح صفحة التنزيل',
    updNoFeed: 'هذا الإصدار لا يتحقق من التحديثات تلقائيًا. نزّل أحدث إصدار من صفحة التنزيل.',
    updNotifyDesc:
      'سيتم تنزيل الإصدار الجديد وفتحه. بعد ذلك، أغلق FaamOffice واسحب FaamOffice إلى مجلد التطبيقات لاستبدال الإصدار القديم.',
    updNotifyDescPkg: 'نزّل حزمة التثبيت الجديدة وثبّتها لتحديث FaamOffice.',
    updDownloadPackage: 'تنزيل الحزمة',
    updReady:
      'تم فتح برنامج التثبيت. أغلق FaamOffice، ثم اسحب FaamOffice إلى مجلد التطبيقات واختر «استبدال».',
    updQuitApp: 'إنهاء FaamOffice',
    updBrowserFallback:
      'تعذّر تنزيل التحديث داخل التطبيق، لذا فُتح في متصفحك. افتح الملف الذي تم تنزيله، وأغلق FaamOffice، ثم اسحب FaamOffice إلى مجلد التطبيقات.',
    updStore: 'يتم تحديث FaamOffice المثبّت من Microsoft Store تلقائيًا عبر المتجر.',
    updOpenStore: 'فتح Microsoft Store',
  },
  pt: {
    updTitle: 'Atualização de Software',
    updHeadline: 'Uma nova versão está disponível',
    updDesc:
      'Esta atualização inclui melhorias de desempenho e correções de erros. Recomendamos atualizar agora.',
    updDownload: 'Atualizar agora',
    updLater: 'Minimizar',
    updInstall: 'Reiniciar e instalar',
    updDownloading: 'Baixando a atualização…',
    updFailed: 'Falha no download. Verifique sua rede e tente novamente.',
    updRetry: 'Tentar novamente',
    updManual:
      'A atualização automática falhou. Baixe a versão mais recente na página de download e instale manualmente.',
    updUpToDate: 'Você está atualizado (versão {version}).',
    updCheckFailed: 'Não foi possível procurar atualizações. Verifique sua rede e tente novamente.',
    updOpenDownload: 'Abrir página de download',
    updNoFeed:
      'Esta versão não procura atualizações automaticamente. Baixe a versão mais recente na página de download.',
    updNotifyDesc:
      'A nova versão será baixada e aberta. Depois, encerre o FaamOffice e arraste o FaamOffice para a pasta Aplicativos para substituir a versão antiga.',
    updNotifyDescPkg: 'Baixe o novo pacote de instalação e instale-o para atualizar o FaamOffice.',
    updDownloadPackage: 'Baixar pacote',
    updReady:
      'O instalador está aberto. Encerre o FaamOffice, arraste o FaamOffice para a pasta Aplicativos e escolha Substituir.',
    updQuitApp: 'Encerrar o FaamOffice',
    updBrowserFallback:
      'Não foi possível baixar a atualização no aplicativo, então ela foi aberta no seu navegador. Abra o arquivo baixado, encerre o FaamOffice e arraste o FaamOffice para a pasta Aplicativos.',
    updStore: 'O FaamOffice da Microsoft Store é atualizado automaticamente pela Store.',
    updOpenStore: 'Abrir a Microsoft Store',
  },
  it: {
    updTitle: 'Aggiornamento software',
    updHeadline: 'È disponibile una nuova versione',
    updDesc:
      'Questo aggiornamento include miglioramenti delle prestazioni e correzioni di bug. Consigliamo di aggiornare subito.',
    updDownload: 'Aggiorna ora',
    updLater: 'Riduci a icona',
    updInstall: 'Riavvia e installa',
    updDownloading: "Download dell'aggiornamento…",
    updFailed: 'Download non riuscito. Controlla la rete e riprova.',
    updRetry: 'Riprova',
    updManual:
      "Aggiornamento automatico non riuscito. Scarica l'ultima versione dalla pagina di download e installala manualmente.",
    updUpToDate: 'Sei aggiornato (versione {version}).',
    updCheckFailed: 'Impossibile controllare gli aggiornamenti. Verifica la rete e riprova.',
    updOpenDownload: 'Apri pagina di download',
    updNoFeed:
      'Questa versione non controlla automaticamente gli aggiornamenti. Scarica la versione più recente dalla pagina di download.',
    updNotifyDesc:
      'La nuova versione verrà scaricata e aperta. Poi esci da FaamOffice e trascina FaamOffice nella cartella Applicazioni per sostituire la versione precedente.',
    updNotifyDescPkg:
      'Scarica il nuovo pacchetto di installazione e installalo per aggiornare FaamOffice.',
    updDownloadPackage: 'Scarica pacchetto',
    updReady:
      'Il programma di installazione è aperto. Esci da FaamOffice, poi trascina FaamOffice nella cartella Applicazioni e scegli Sostituisci.',
    updQuitApp: 'Esci da FaamOffice',
    updBrowserFallback:
      "Non è stato possibile scaricare l'aggiornamento nell'app, quindi è stato aperto nel browser. Apri il file scaricato, esci da FaamOffice e trascina FaamOffice nella cartella Applicazioni.",
    updStore: 'FaamOffice dal Microsoft Store viene aggiornato automaticamente dallo Store.',
    updOpenStore: 'Apri Microsoft Store',
  },
  pl: {
    updTitle: 'Aktualizacja oprogramowania',
    updHeadline: 'Dostępna jest nowa wersja',
    updDesc:
      'Ta aktualizacja zawiera ulepszenia wydajności i poprawki błędów. Zalecamy aktualizację teraz.',
    updDownload: 'Aktualizuj teraz',
    updLater: 'Zminimalizuj',
    updInstall: 'Uruchom ponownie i zainstaluj',
    updDownloading: 'Pobieranie aktualizacji…',
    updFailed: 'Pobieranie nie powiodło się. Sprawdź sieć i spróbuj ponownie.',
    updRetry: 'Spróbuj ponownie',
    updManual:
      'Automatyczna aktualizacja nie powiodła się. Pobierz najnowszą wersję ze strony pobierania i zainstaluj ją ręcznie.',
    updUpToDate: 'Masz aktualną wersję ({version}).',
    updCheckFailed: 'Nie udało się sprawdzić aktualizacji. Sprawdź sieć i spróbuj ponownie.',
    updOpenDownload: 'Otwórz stronę pobierania',
    updNoFeed:
      'Ta wersja nie sprawdza aktualizacji automatycznie. Pobierz najnowszą wersję ze strony pobierania.',
    updNotifyDesc:
      'Nowa wersja zostanie pobrana i otwarta. Następnie zakończ FaamOffice i przeciągnij FaamOffice do folderu Aplikacje, aby zastąpić starą wersję.',
    updNotifyDescPkg:
      'Pobierz nowy pakiet instalacyjny i zainstaluj go, aby zaktualizować FaamOffice.',
    updDownloadPackage: 'Pobierz pakiet',
    updReady:
      'Instalator jest otwarty. Zakończ FaamOffice, a następnie przeciągnij FaamOffice do folderu Aplikacje i wybierz Zastąp.',
    updQuitApp: 'Zakończ FaamOffice',
    updBrowserFallback:
      'Nie udało się pobrać aktualizacji w aplikacji, więc otwarto ją w przeglądarce. Otwórz pobrany plik, zakończ FaamOffice i przeciągnij FaamOffice do folderu Aplikacje.',
    updStore: 'FaamOffice ze sklepu Microsoft Store jest aktualizowany automatycznie przez sklep.',
    updOpenStore: 'Otwórz Microsoft Store',
  },
  cs: {
    updTitle: 'Aktualizace softwaru',
    updHeadline: 'Je k dispozici nová verze',
    updDesc:
      'Tato aktualizace obsahuje vylepšení výkonu a opravy chyb. Doporučujeme aktualizovat hned.',
    updDownload: 'Aktualizovat nyní',
    updLater: 'Minimalizovat',
    updInstall: 'Restartovat a nainstalovat',
    updDownloading: 'Stahování aktualizace…',
    updFailed: 'Stažení aktualizace se nezdařilo. Zkontrolujte síť a zkuste to znovu.',
    updRetry: 'Zkusit znovu',
    updManual:
      'Automatická aktualizace se nezdařila. Stáhněte si nejnovější verzi ze stránky pro stažení a nainstalujte ji ručně.',
    updUpToDate: 'Máte aktuální verzi ({version}).',
    updCheckFailed: 'Aktualizace se nepodařilo zkontrolovat. Zkontrolujte síť a zkuste to znovu.',
    updOpenDownload: 'Otevřít stránku pro stažení',
    updNoFeed:
      'Tato verze nekontroluje aktualizace automaticky. Stáhněte si nejnovější verzi ze stránky pro stažení.',
    updNotifyDesc:
      'Nová verze se stáhne a otevře. Poté ukončete FaamOffice a přetáhněte FaamOffice do složky Aplikace, aby nahradil starou verzi.',
    updNotifyDescPkg:
      'Stáhněte si nový instalační balíček a nainstalujte ho, abyste FaamOffice aktualizovali.',
    updDownloadPackage: 'Stáhnout balíček',
    updReady:
      'Instalátor je otevřený. Ukončete FaamOffice, potom přetáhněte FaamOffice do složky Aplikace a zvolte Nahradit.',
    updQuitApp: 'Ukončit FaamOffice',
    updBrowserFallback:
      'Aktualizaci se nepodařilo stáhnout v aplikaci, proto byla otevřena v prohlížeči. Otevřete stažený soubor, ukončete FaamOffice a přetáhněte FaamOffice do složky Aplikace.',
    updStore: 'FaamOffice z Microsoft Storu se aktualizuje automaticky přes Microsoft Store.',
    updOpenStore: 'Otevřít Microsoft Store',
  },
  nl: {
    updTitle: 'Software-update',
    updHeadline: 'Er is een nieuwe versie beschikbaar',
    updDesc:
      'Deze update bevat prestatieverbeteringen en foutoplossingen. We raden aan nu bij te werken.',
    updDownload: 'Nu bijwerken',
    updLater: 'Minimaliseren',
    updInstall: 'Opnieuw starten en installeren',
    updDownloading: 'Update wordt gedownload…',
    updFailed: 'Download mislukt. Controleer uw netwerk en probeer het opnieuw.',
    updRetry: 'Opnieuw proberen',
    updManual:
      'Automatische update mislukt. Download de nieuwste versie via de downloadpagina en installeer deze handmatig.',
    updUpToDate: 'U bent up-to-date (versie {version}).',
    updCheckFailed:
      'Kan niet controleren op updates. Controleer uw netwerk en probeer het opnieuw.',
    updOpenDownload: 'Downloadpagina openen',
    updNoFeed:
      'Deze versie controleert niet automatisch op updates. Download de nieuwste versie via de downloadpagina.',
    updNotifyDesc:
      'De nieuwe versie wordt gedownload en geopend. Stop daarna FaamOffice en sleep FaamOffice naar de map Apps om de oude versie te vervangen.',
    updNotifyDescPkg:
      'Download het nieuwe installatiepakket en installeer het om FaamOffice bij te werken.',
    updDownloadPackage: 'Pakket downloaden',
    updReady:
      'Het installatieprogramma is geopend. Stop FaamOffice, sleep FaamOffice daarna naar de map Apps en kies Vervang.',
    updQuitApp: 'Stop FaamOffice',
    updBrowserFallback:
      'De update kon niet in de app worden gedownload en is daarom in uw browser geopend. Open het gedownloade bestand, stop FaamOffice en sleep FaamOffice naar de map Apps.',
    updStore: 'FaamOffice uit de Microsoft Store wordt automatisch bijgewerkt door de Store.',
    updOpenStore: 'Microsoft Store openen',
  },
  ms: {
    updTitle: 'Kemas Kini Perisian',
    updHeadline: 'Versi baharu tersedia',
    updDesc:
      'Kemas kini ini merangkumi penambahbaikan prestasi dan pembetulan pepijat. Kami syorkan kemas kini sekarang.',
    updDownload: 'Kemas Kini Sekarang',
    updLater: 'Minimumkan',
    updInstall: 'Mula Semula & Pasang',
    updDownloading: 'Memuat turun kemas kini…',
    updFailed: 'Muat turun gagal. Semak rangkaian anda dan cuba lagi.',
    updRetry: 'Cuba Lagi',
    updManual:
      'Kemas kini automatik gagal. Sila muat turun versi terkini dari halaman muat turun dan pasang secara manual.',
    updUpToDate: 'Anda menggunakan versi terkini (versi {version}).',
    updCheckFailed: 'Tidak dapat menyemak kemas kini. Semak rangkaian anda dan cuba lagi.',
    updOpenDownload: 'Buka Halaman Muat Turun',
    updNoFeed:
      'Binaan ini tidak menyemak kemas kini secara automatik. Muat turun versi terkini dari halaman muat turun.',
    updNotifyDesc:
      'Versi baharu akan dimuat turun dan dibuka. Kemudian, keluar dari FaamOffice dan seret FaamOffice ke folder Aplikasi untuk menggantikan versi lama.',
    updNotifyDescPkg:
      'Muat turun pakej pemasangan baharu dan pasangkannya untuk mengemas kini FaamOffice.',
    updDownloadPackage: 'Muat Turun Pakej',
    updReady:
      'Pemasang telah dibuka. Keluar dari FaamOffice, kemudian seret FaamOffice ke folder Aplikasi dan pilih Ganti.',
    updQuitApp: 'Keluar dari FaamOffice',
    updBrowserFallback:
      'Kemas kini tidak dapat dimuat turun dalam aplikasi, jadi ia dibuka dalam pelayar anda. Buka fail yang dimuat turun, keluar dari FaamOffice dan seret FaamOffice ke folder Aplikasi.',
    updStore: 'FaamOffice daripada Microsoft Store dikemas kini secara automatik oleh Store.',
    updOpenStore: 'Buka Microsoft Store',
  },
  he: {
    updTitle: 'עדכון תוכנה',
    updHeadline: 'גרסה חדשה זמינה',
    updDesc: 'עדכון זה כולל שיפורי ביצועים ותיקוני באגים. מומלץ לעדכן עכשיו.',
    updDownload: 'עדכן עכשיו',
    updLater: 'מזער',
    updInstall: 'הפעל מחדש והתקן',
    updDownloading: 'מוריד את העדכון…',
    updFailed: 'ההורדה נכשלה. בדוק את הרשת ונסה שוב.',
    updRetry: 'נסה שוב',
    updManual: 'העדכון האוטומטי נכשל. הורד את הגרסה העדכנית מדף ההורדות והתקן אותה ידנית.',
    updUpToDate: 'הגרסה שלך עדכנית (גרסה {version}).',
    updCheckFailed: 'לא ניתן לבדוק עדכונים. בדקו את הרשת ונסו שוב.',
    updOpenDownload: 'פתח את דף ההורדות',
    updNoFeed: 'גרסה זו אינה בודקת עדכונים באופן אוטומטי. הורד את הגרסה העדכנית מדף ההורדות.',
    updNotifyDesc:
      'הגרסה החדשה תורד ותיפתח. לאחר מכן צא מ-FaamOffice וגרור את FaamOffice לתיקיית היישומים כדי להחליף את הגרסה הישנה.',
    updNotifyDescPkg: 'הורד את חבילת ההתקנה החדשה והתקן אותה כדי לעדכן את FaamOffice.',
    updDownloadPackage: 'הורד חבילה',
    updReady:
      'תוכנית ההתקנה פתוחה. צא מ-FaamOffice, ואז גרור את FaamOffice לתיקיית היישומים ובחר „החלף”.',
    updQuitApp: 'צא מ-FaamOffice',
    updBrowserFallback:
      'לא ניתן היה להוריד את העדכון בתוך האפליקציה, ולכן הוא נפתח בדפדפן. פתח את הקובץ שהורד, צא מ-FaamOffice וגרור את FaamOffice לתיקיית היישומים.',
    updStore: 'FaamOffice מ-Microsoft Store מתעדכן אוטומטית דרך החנות.',
    updOpenStore: 'פתח את Microsoft Store',
  },
  hi: {
    updTitle: 'सॉफ़्टवेयर अपडेट',
    updHeadline: 'नया संस्करण उपलब्ध है',
    updDesc:
      'इस अपडेट में प्रदर्शन सुधार और बग फ़िक्स शामिल हैं। हम अभी अपडेट करने की सलाह देते हैं।',
    updDownload: 'अभी अपडेट करें',
    updLater: 'छोटा करें',
    updInstall: 'पुनरारंभ करें और इंस्टॉल करें',
    updDownloading: 'अपडेट डाउनलोड हो रहा है…',
    updFailed: 'डाउनलोड विफल रहा। अपना नेटवर्क जाँचें और पुनः प्रयास करें।',
    updRetry: 'पुनः प्रयास करें',
    updManual:
      'स्वचालित अपडेट विफल रहा। कृपया डाउनलोड पृष्ठ से नवीनतम संस्करण प्राप्त करें और मैन्युअल रूप से इंस्टॉल करें।',
    updUpToDate: 'आप अपडेटेड हैं (संस्करण {version}).',
    updCheckFailed: 'अपडेट जांच नहीं हो सकी। अपना नेटवर्क जांचें और फिर से प्रयास करें।',
    updOpenDownload: 'डाउनलोड पृष्ठ खोलें',
    updNoFeed: 'यह बिल्ड अपडेट अपने आप नहीं जाँचता। डाउनलोड पृष्ठ से नवीनतम संस्करण प्राप्त करें।',
    updNotifyDesc:
      'नया संस्करण डाउनलोड होकर खुल जाएगा। फिर FaamOffice बंद करें और पुराने संस्करण को बदलने के लिए FaamOffice को Applications फ़ोल्डर में खींचें।',
    updNotifyDescPkg:
      'FaamOffice को अपडेट करने के लिए नया इंस्टॉलेशन पैकेज डाउनलोड करके इंस्टॉल करें।',
    updDownloadPackage: 'पैकेज डाउनलोड करें',
    updReady:
      'इंस्टॉलर खुल गया है। FaamOffice बंद करें, फिर FaamOffice को Applications फ़ोल्डर में खींचें और Replace चुनें।',
    updQuitApp: 'FaamOffice बंद करें',
    updBrowserFallback:
      'अपडेट ऐप में डाउनलोड नहीं हो सका, इसलिए इसे आपके ब्राउज़र में खोला गया है। डाउनलोड की गई फ़ाइल खोलें, FaamOffice बंद करें और FaamOffice को Applications फ़ोल्डर में खींचें।',
    updStore: 'Microsoft Store से इंस्टॉल किया गया FaamOffice, Store द्वारा अपने आप अपडेट होता है।',
    updOpenStore: 'Microsoft Store खोलें',
  },
  'zh-TW': {
    updTitle: '軟體更新',
    updHeadline: '發現新版本',
    updDesc: '新版本包含效能改進與問題修復，建議立即更新。',
    updDownload: '立即更新',
    updLater: '最小化',
    updInstall: '立即重新啟動安裝',
    updDownloading: '正在下載更新…',
    updFailed: '更新下載失敗，請檢查網路後重試。',
    updRetry: '重試',
    updManual: '自動更新失敗，請從下載頁面取得最新版本並手動安裝。',
    updUpToDate: '已是最新版本（{version}）。',
    updCheckFailed: '無法檢查更新，請檢查網路後重試。',
    updOpenDownload: '前往下載頁面',
    updNoFeed: '此版本不會自動檢查更新，請從下載頁面取得最新版本。',
    updNotifyDesc:
      '新版本安裝檔將下載並自動開啟。接著請結束 FaamOffice，並將 FaamOffice 拖到「應用程式」檔案夾以取代舊版本。',
    updNotifyDescPkg: '請下載新的安裝套件並安裝，以更新 FaamOffice。',
    updDownloadPackage: '下載安裝套件',
    updReady:
      '安裝檔已開啟。請結束 FaamOffice，然後將 FaamOffice 拖到「應用程式」檔案夾並選擇「取代」。',
    updQuitApp: '結束 FaamOffice',
    updBrowserFallback:
      '無法在應用程式內下載更新，已改在瀏覽器中開啟。請開啟下載的檔案、結束 FaamOffice，然後將 FaamOffice 拖到「應用程式」檔案夾。',
    updStore: '來自 Microsoft Store 的 FaamOffice 會由 Microsoft Store 自動更新。',
    updOpenStore: '開啟 Microsoft Store',
  },
})

const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// After this many failed download/apply attempts for the same version the
// dialog stops offering "retry" and guides the user to a manual download
// instead (install flow). Covers permanently broken update paths, where every
// retry fails the same way while the error looks like a download failure.
const MANUAL_FALLBACK_AFTER = 2

/** app-settings key of the nag record (UpdatePromptState) */
export const UPDATE_PROMPT_KEY = 'updatePrompt'
/** the automatic card shows one version at most once per this window */
export const NAG_INTERVAL_MS = 24 * 60 * 60 * 1000
/** environment switch: '0' turns every update check off */
export const UPDATES_ENV = 'FAAMOFFICE_UPDATES'

/** Last-resort manual link: the website's download page always offers the
 * newest release for every platform (Vietnamese or English). */
const SITE_URL = 'https://faamoffice.net'

function downloadPageUrl(): string {
  return `${SITE_URL}/${getUiLang() === 'vi' ? 'vi' : 'en'}/download`
}

/** the GitHub Releases feed prefix release.yml bakes into tag builds */
const GITHUB_LATEST_FEED =
  /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/releases\/latest\/download\/$/
/** a release version as tags carry it (v<version>); build metadata is never used */
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** plain-http feeds are accepted only here (local test builds, see the header) */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/// Trusted base URL baked into resources/app-update.yml (https, or http on a
/// loopback host for local testing). Download links are always rebuilt from
/// this base rather than trusting URLs supplied by remotely fetched update
/// metadata. null = this build has no update feed.
function updateFeedBaseUrl(): string | null {
  try {
    const yml = readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const value = /^url:\s*['"]?([^'"\s]+)/m.exec(yml)?.[1]
    if (!value) return null
    const url = new URL(value)
    const trusted =
      url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    if (!trusted || url.username || url.password) return null
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/// Where the files of release `version` live. On the GitHub feed that is the
/// release's own tag (…/releases/download/v<version>/): …/latest/download/
/// may already point at a newer release whose file names differ. Any other
/// feed (a local test server) serves its files next to the feed files.
function releaseAssetUrl(version: string, name: string): string | null {
  const base = updateFeedBaseUrl()
  if (base === null) return null
  const github = GITHUB_LATEST_FEED.exec(base)
  let assetBase = base
  if (github) {
    if (!RELEASE_VERSION.test(version)) return null
    assetBase = `https://github.com/${github[1]}/${github[2]}/releases/download/v${version}/`
  }
  return new URL(encodeURIComponent(name), assetBase).toString()
}

/** how this install updates itself (see the header) */
type UpdatePlan = 'nsis' | 'appimage' | 'mac-dmg' | 'deb' | 'rpm'

const flowOf = (plan: UpdatePlan): UpdateFlow =>
  plan === 'nsis' || plan === 'appimage' ? 'install' : 'notify'

/** the deb/rpm package name (deb/rpm packageName in electron-builder.cjs) */
const LINUX_PACKAGE_NAME = 'faamoffice'
/** where dpkg keeps the file list of every installed package */
const DPKG_INFO_DIR = '/var/lib/dpkg/info'
/** dpkg's name for process.arch, used in Multi-Arch list names */
const DPKG_ARCH: Partial<Record<string, string>> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: 'i386',
  arm: 'armhf',
}

function realpathOrNull(file: string): string | null {
  try {
    return realpathSync(file)
  } catch {
    return null
  }
}

/// Whether dpkg installed the running executable: a deb registers every file
/// it ships in /var/lib/dpkg/info/<package>.list (<package>:<arch>.list for
/// Multi-Arch packages). An entry naming the executable through a symlinked
/// directory still counts; process.execPath is always the resolved path.
function dpkgOwnsExecutable(): boolean {
  const exe = process.execPath
  const arch = DPKG_ARCH[process.arch]
  const lists = [`${LINUX_PACKAGE_NAME}.list`]
  if (arch) lists.push(`${LINUX_PACKAGE_NAME}:${arch}.list`)
  for (const list of lists) {
    let entries: string[]
    try {
      entries = readFileSync(path.posix.join(DPKG_INFO_DIR, list), 'utf8').split('\n')
    } catch {
      continue
    }
    const owns = entries.some(
      (entry) =>
        entry === exe ||
        (path.posix.basename(entry) === path.posix.basename(exe) && realpathOrNull(entry) === exe),
    )
    if (owns) return true
  }
  return false
}

/// deb or rpm install. electron-builder writes resources/package-type into
/// both, but its value cannot tell them apart: deb and rpm are packed
/// concurrently from the one linux-unpacked directory, each writing its own
/// target into that same file first, so both packages ship whichever value
/// landed last. The file only marks a package install (electron-updater also
/// needs it to check at all); dpkg's records decide the format, and a package
/// install dpkg does not know is the rpm.
function linuxPackageType(): 'deb' | 'rpm' | null {
  try {
    const type = readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim()
    if (type !== 'deb' && type !== 'rpm') return null
  } catch {
    return null
  }
  return dpkgOwnsExecutable() ? 'deb' : 'rpm'
}

function detectPlan(): UpdatePlan | null {
  if (process.platform === 'win32') return 'nsis'
  if (process.platform === 'darwin') return 'mac-dmg'
  if (process.platform !== 'linux') return null
  // electron-updater's AppImageUpdater needs the APPIMAGE env var the
  // AppImage runtime sets; deb/rpm installs carry resources/package-type
  if (process.env.APPIMAGE) return 'appimage'
  return linuxPackageType()
}

/// The installer a user of this install would download by hand, picked from
/// the update feed's file list: macOS wants the dmg matching process.arch (the
/// zip is Squirrel-only), Windows the NSIS exe matching process.arch (the
/// arm64 one carries an -arm64 suffix, the x64 one no arch), Linux the
/// AppImage, deb or rpm it was installed from. Only basenames are used; the
/// URL is rebuilt by releaseAssetUrl. The rpm is not listed in
/// latest-linux.yml (publish: null in electron-builder.cjs), so deb/rpm fall
/// back to the artifactName patterns spelled out there.
function manualDownloadUrlFor(info: UpdateInfo, plan: UpdatePlan): string | null {
  const names = (info.files ?? []).flatMap((file) => {
    const name = feedFileName(file.url)
    return name ? [name] : []
  })
  const pick = (match: (name: string) => boolean): string | null => names.find(match) ?? null
  const x64 = process.arch === 'x64'
  let chosen: string | null
  switch (plan) {
    case 'mac-dmg': {
      const arm =
        pick((name) => name.endsWith('-arm64.dmg')) ??
        pick((name) => name.endsWith('-universal.dmg'))
      const intel =
        pick((name) => name.endsWith('.dmg') && !/-(arm64|universal)\.dmg$/.test(name)) ??
        pick((name) => name.endsWith('-universal.dmg'))
      // an arm64-only dmg never launches on an Intel Mac: the download page instead
      chosen = process.arch === 'arm64' ? (arm ?? intel) : intel
      break
    }
    case 'nsis': {
      const arm = pick((name) => name.endsWith('-arm64.exe'))
      const intel = pick((name) => name.endsWith('.exe') && !name.endsWith('-arm64.exe'))
      chosen = process.arch === 'arm64' ? (arm ?? intel) : (intel ?? arm)
      break
    }
    case 'appimage':
      chosen = pick((name) => name.endsWith('.AppImage'))
      break
    case 'deb':
      chosen =
        pick((name) => name.endsWith('.deb')) ??
        (x64 && RELEASE_VERSION.test(info.version) ? `faamoffice_${info.version}_amd64.deb` : null)
      break
    case 'rpm':
      chosen =
        pick((name) => name.endsWith('.rpm')) ??
        (x64 && RELEASE_VERSION.test(info.version) ? `faamoffice-${info.version}.x86_64.rpm` : null)
      break
  }
  return chosen === null ? null : releaseAssetUrl(info.version, chosen)
}

/** persisted under UPDATE_PROMPT_KEY: the version whose automatic card was last
 * shown or put away, and when (ms epoch) — the once-a-day rule */
export interface UpdatePromptState {
  version: string
  dismissedAt: number
}

/** tolerate missing/corrupt settings values */
export function asUpdatePromptState(value: unknown): UpdatePromptState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.version !== 'string' || !raw.version) return null
  if (typeof raw.dismissedAt !== 'number' || !Number.isFinite(raw.dismissedAt)) return null
  return { version: raw.version, dismissedAt: raw.dismissedAt }
}

/** whether the automatic card for `version` stays quiet at `now`; a stamp
 * from the future (the clock was set back) counts as expired */
export function isNagQuiet(state: UpdatePromptState | null, version: string, now: number): boolean {
  if (!state || state.version !== version) return false
  const age = now - state.dismissedAt
  return age >= 0 && age < NAG_INTERVAL_MS
}

let started = false
// re-shows the GENOFFICE_FAKE_UPDATE window so the manual check is
// exercisable in dev runs too
let fakeShowAgain: (() => void) | null = null
let manualCheckInFlight = false

// electron-updater feed name per user-facing channel. The platform suffix is
// appended by electron-updater itself (latest.yml on Windows, latest-mac.yml
// on macOS, latest-linux.yml on Linux x64). No beta feed is published, so the
// Beta channel reads the stable feed too rather than a file that never exists.
const CHANNEL_FEED: Record<UpdateChannel, string> = { stable: 'latest', beta: 'latest' }

// true once the packaged-run updater is configured; channel switches before
// that (or in dev runs) must not touch electron-updater
let updaterActive = false

function log(...args: unknown[]): void {
  console.log('[updater]', ...args)
}

function uiStrings(plan: UpdatePlan): UpdateUiStrings {
  const lang = getUiLang()
  const strings: UpdateUiStrings = {
    title: tUpd(lang, 'updTitle'),
    headline: tUpd(lang, 'updHeadline'),
    desc: tUpd(lang, 'updDesc'),
    download: tUpd(lang, 'updDownload'),
    later: tUpd(lang, 'updLater'),
    install: tUpd(lang, 'updInstall'),
    downloading: tUpd(lang, 'updDownloading'),
    failed: tUpd(lang, 'updFailed'),
    retry: tUpd(lang, 'updRetry'),
    manualDesc: tUpd(lang, 'updManual'),
    openDownload: tUpd(lang, 'updOpenDownload'),
    ready: tUpd(lang, 'updReady'),
    quit: tUpd(lang, 'updQuitApp'),
  }
  if (plan === 'mac-dmg') {
    strings.desc = tUpd(lang, 'updNotifyDesc')
    strings.manualDesc = tUpd(lang, 'updBrowserFallback')
  } else if (plan === 'deb' || plan === 'rpm') {
    strings.desc = tUpd(lang, 'updNotifyDescPkg')
    strings.download = tUpd(lang, 'updDownloadPackage')
  }
  return strings
}

function initialState(version: string, plan: UpdatePlan): UpdateUiState {
  return {
    phase: 'available',
    flow: flowOf(plan),
    version,
    currentVersion: app.getVersion(),
    percent: 0,
    lang: htmlLang(getUiLang()),
    strings: uiStrings(plan),
  }
}

export function applyUpdateChannel(channel: UpdateChannel): void {
  if (!updaterActive) return
  autoUpdater.channel = CHANNEL_FEED[channel]
  // the channel setter unconditionally flips allowDowngrade to true; force it
  // back off since a beta user switching to stable must not downgrade
  autoUpdater.allowDowngrade = false
  log('channel switched:', channel)
  autoUpdater.checkForUpdates().catch((err) => log('check failed:', err?.message ?? err))
}

/** User-triggered check (Help > Check for Updates… / the About dialog button).
 * Unlike the silent launch/periodic checks, every outcome gets explicit
 * feedback: an available update opens the standard update window (even a
 * version put away earlier today — the user just asked for it), up-to-date
 * and failure each get a dialog, and builds that do not check at all (no
 * feed baked in, FAAMOFFICE_UPDATES=0, dev runs, unsupported Linux installs)
 * say so and offer the download page instead of claiming to be current. A
 * Microsoft Store install points at its Store listing instead. */
export async function checkForUpdatesNow(): Promise<void> {
  if (manualCheckInFlight) return
  manualCheckInFlight = true
  try {
    const lang = getUiLang()
    const store = storeListing()
    if (store) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: tUpd(lang, 'updTitle'),
        message: tUpd(lang, 'updStore'),
        buttons: ['OK', tUpd(lang, 'updOpenStore')],
        defaultId: 0,
        cancelId: 0,
      })
      if (response === 1) await openStorePage(store, (url) => shell.openExternal(url))
      return
    }
    if (fakeShowAgain) {
      fakeShowAgain()
      return
    }
    if (!updaterActive) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: tUpd(lang, 'updTitle'),
        message: tUpd(lang, 'updNoFeed'),
        buttons: ['OK', tUpd(lang, 'updOpenDownload')],
        defaultId: 0,
        cancelId: 0,
      })
      if (response === 1) void shell.openExternal(downloadPageUrl())
      return
    }
    let result
    try {
      result = await autoUpdater.checkForUpdates()
      if (result === null) throw new Error('Update check was skipped')
    } catch (err) {
      log('manual check failed:', (err as Error)?.message ?? err)
      await dialog.showMessageBox({
        type: 'warning',
        title: tUpd(lang, 'updTitle'),
        message: tUpd(lang, 'updCheckFailed'),
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
      })
      return
    }
    // an available update already opened the update window via the
    // 'update-available' handler; only "nothing new" needs a dialog here
    if (result.isUpdateAvailable) return
    await dialog.showMessageBox({
      type: 'info',
      title: tUpd(lang, 'updTitle'),
      message: tUpd(lang, 'updUpToDate', { version: app.getVersion() }),
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
    })
  } finally {
    manualCheckInFlight = false
  }
}

export interface AutoUpdaterHooks {
  /**
   * Linux AppImage: the update replaced the running AppImage with a new,
   * versioned file name. Fires synchronously while installing, before the
   * relaunch, so anything pointing at the old path can follow it.
   */
  onAppImageMoved?: (path: string) => void
  /** the persisted nag record (app-settings UPDATE_PROMPT_KEY); without
   * these the once-a-day rule only holds for the running session */
  readPromptState?: () => unknown
  writePromptState?: (state: UpdatePromptState) => void
}

export function initAutoUpdater(
  getWindow: () => BrowserWindow | null,
  initialChannel: UpdateChannel = 'stable',
  hooks: AutoUpdaterHooks = {},
): void {
  if (started) return
  started = true

  // the Store updates its package; electron-updater must not touch it
  if (isStoreInstall()) {
    log('Microsoft Store install: updates come from the Store')
    return
  }

  // dev preview of the update window with a simulated download
  if (!app.isPackaged && process.env.GENOFFICE_FAKE_UPDATE) {
    initFakeUpdate(getWindow, process.env.GENOFFICE_FAKE_UPDATE)
    return
  }
  // Unpacked runs have no app-update.yml and must not hit the feed with a dev
  // version; neither may builds without a baked feed or with checks turned off.
  if (!app.isPackaged) return
  if (process.env[UPDATES_ENV]?.trim() === '0') {
    log(`update checks are off (${UPDATES_ENV}=0)`)
    return
  }
  if (updateFeedBaseUrl() === null) {
    log('this build has no update feed')
    return
  }
  const plan = detectPlan()
  if (plan === null) return
  const flow = flowOf(plan)

  updaterActive = true
  autoUpdater.channel = CHANNEL_FEED[initialChannel]
  // the channel setter unconditionally flips allowDowngrade to true; force it
  // back off since a beta user switching to stable must not downgrade
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = false
  // install flow: if the user picked "later" after download, install on
  // normal quit. The notify flows never hand electron-updater a download.
  autoUpdater.autoInstallOnAppQuit = flow === 'install'
  // full-package policy: never attempt blockmap differential downloads (the
  // release publishes .blockmap files, but GitHub's asset CDN is not relied on
  // for multi-range requests)
  autoUpdater.disableDifferentialDownload = true
  // Range-resumable installer downloads: a dropped connection restarts from
  // the .part bytes instead of byte 0 (falls back to the stock download on
  // any error placing the request — see update-resume.ts)
  if (flow === 'install')
    installResumeDownload(autoUpdater as unknown as Parameters<typeof installResumeDownload>[0])

  // ---- the once-a-day record; the memory copy covers an unwritable settings file
  let promptMemory: UpdatePromptState | null = null
  const nagQuiet = (version: string): boolean => {
    const now = Date.now()
    if (isNagQuiet(promptMemory, version, now)) return true
    try {
      return isNagQuiet(asUpdatePromptState(hooks.readPromptState?.()), version, now)
    } catch {
      return false
    }
  }
  const stampPrompt = (version: string): void => {
    promptMemory = { version, dismissedAt: Date.now() }
    try {
      hooks.writePromptState?.(promptMemory)
    } catch (err) {
      log('could not persist the update prompt:', (err as Error)?.message ?? err)
    }
  }

  let latestSeenVersion: string | null = null
  let latestInfo: UpdateInfo | null = null
  // installer link for latestSeenVersion (tag-pinned, arch/format-correct);
  // null falls back to the website's download page
  let manualDownloadUrl: string | null = null
  // consecutive failed attempts for latestSeenVersion; a download can fail
  // through the downloadUpdate() rejection OR only through the 'error' event,
  // so both paths funnel into failDownload() and the in-flight flag dedupes them
  let failedAttempts = 0
  let downloadInFlight = false
  // where latestSeenVersion got to, so re-opening the window for the same
  // version (a manual check after "later") resumes there instead of offering
  // "Update Now" over a download that is running or already finished
  let phase: UpdatePhase = 'available'
  let percent = 0

  const setPhase = (patch: { phase: UpdatePhase; percent?: number }): void => {
    phase = patch.phase
    if (patch.percent !== undefined) percent = patch.percent
    pushUpdateState(patch)
  }

  const failDownload = (): void => {
    if (!downloadInFlight) return
    downloadInFlight = false
    failedAttempts += 1
    setPhase({ phase: failedAttempts >= MANUAL_FALLBACK_AFTER ? 'manual' : 'error' })
  }

  const openDownloadPage = (): void => {
    void shell.openExternal(manualDownloadUrl ?? downloadPageUrl())
  }

  /** macOS notify flow: fetch, verify and open the dmg; the browser on any failure */
  const downloadDmg = (): void => {
    const info = latestInfo
    if (!info) return
    downloadInFlight = true
    setPhase({ phase: 'downloading', percent: 0 })
    const fetchAndOpen = async (): Promise<void> => {
      const choice = pickMacDmg(info.files ?? [], process.arch)
      const url = choice ? releaseAssetUrl(info.version, choice.name) : null
      if (!choice || !url) throw new Error('the feed lists no verifiable dmg for this Mac')
      const file = await downloadMacDmg({
        url: new URL(url),
        dir: path.join(app.getPath('temp'), 'faamoffice-updates'),
        choice,
        onProgress: (value) => setPhase({ phase: 'downloading', percent: value }),
      })
      const failure = await shell.openPath(file)
      if (failure) throw new Error(`could not open ${file}: ${failure}`)
    }
    fetchAndOpen().then(
      () => {
        downloadInFlight = false
        log('installer opened:', info.version)
        setPhase({ phase: 'ready', percent: 100 })
      },
      (err) => {
        downloadInFlight = false
        log('dmg download failed, opening it in the browser:', err?.message ?? err)
        setPhase({ phase: 'manual' })
        openDownloadPage()
      },
    )
  }

  const actions = {
    onDownload: () => {
      // deb/rpm: the browser fetches the package; the user installs it
      if (plan === 'deb' || plan === 'rpm') {
        openDownloadPage()
        return
      }
      if (phase === 'downloading' || phase === 'downloaded' || phase === 'ready') return
      if (plan === 'mac-dmg') {
        downloadDmg()
        return
      }
      downloadInFlight = true
      setPhase({ phase: 'downloading', percent: 0 })
      autoUpdater.downloadUpdate().catch((err) => {
        log('download failed:', err?.message ?? err)
        failDownload()
      })
    },
    onInstall: () => {
      closeUpdateWindow()
      // let the window fully close before tearing the app down; the notify
      // flow only quits, so the opened dmg can replace the app
      if (flow === 'notify') setImmediate(() => app.quit())
      else setImmediate(() => autoUpdater.quitAndInstall(true, true))
    },
    onLater: () => {
      if (latestSeenVersion) stampPrompt(latestSeenVersion)
      closeUpdateWindow()
    },
    onOpenDownload: openDownloadPage,
  }

  autoUpdater.on('error', (err) => {
    // network failures during background checks are expected; only surface
    // when the user is watching an electron-updater download (the dmg
    // download reports its own failures)
    log('error:', err?.message ?? err)
    if (flow === 'install') failDownload()
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // read synchronously: electron-updater emits this inside the
    // checkForUpdates() call a manual check is awaiting
    const manual = manualCheckInFlight
    const sameVersionRecheck = info.version === latestSeenVersion
    // progress/downloaded/error events carry no version, so a newer release
    // landing while the previous one is downloading, downloaded or opened
    // stays out until that flow ends (the next launch picks up the newer
    // one); it must not hijack the open window
    if (!sameVersionRecheck && (downloadInFlight || phase === 'downloaded' || phase === 'ready')) {
      log('update available:', info.version, 'ignored while', latestSeenVersion, 'is', phase)
      // an explicit check still owes feedback: bring back the flow in progress
      // (a background recheck stays quiet)
      if (manual && !isUpdateWindowOpen()) {
        const version = latestSeenVersion ?? info.version
        showUpdateWindow(getWindow(), { ...initialState(version, plan), phase, percent }, actions)
      }
      return
    }
    if (!sameVersionRecheck) {
      failedAttempts = 0
      phase = 'available'
      percent = 0
    }
    latestSeenVersion = info.version
    latestInfo = info
    manualDownloadUrl = manualDownloadUrlFor(info, plan)
    log('update available:', info.version)
    // a periodic recheck resolving to the version the open dialog already
    // shows must not reset its phase to 'available' — that would wipe an
    // in-progress download or a terminal 'manual' fallback back to the
    // "Update Now" offer
    if (sameVersionRecheck && isUpdateWindowOpen()) return
    const version = info.version
    const state = (): UpdateUiState => ({ ...initialState(version, plan), phase, percent })
    if (manual || isUpdateWindowOpen()) {
      showUpdateWindow(getWindow(), state(), actions)
      return
    }
    // known to Settings → About right away; the card itself shows once a day
    // and never over onboarding or an announcement
    rememberUpdate(getWindow(), state(), actions)
    if (nagQuiet(version)) {
      log('update card for', version, 'already shown today')
      return
    }
    whenUpdatePromptAllowed(() => {
      // time may have passed: a newer version, an explicit open, a dismissal
      if (latestSeenVersion !== version || isUpdateWindowOpen() || nagQuiet(version)) return
      stampPrompt(version)
      showUpdateWindow(getWindow(), state(), actions)
    })
  })

  if (plan === 'appimage') {
    // electron-updater deletes the running FaamOffice-<v>.AppImage and moves
    // the update to its own versioned name
    autoUpdater.on('appimage-filename-updated', (newPath: string) => {
      log('AppImage moved to', newPath)
      try {
        hooks.onAppImageMoved?.(newPath)
      } catch (err) {
        log('AppImage move hook failed:', (err as Error)?.message ?? err)
      }
    })
  }

  autoUpdater.on('download-progress', (progress) => {
    setPhase({ phase: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log('downloaded:', info.version)
    downloadInFlight = false
    failedAttempts = 0
    setPhase({ phase: 'downloaded', percent: 100 })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => log('check failed:', err?.message ?? err))
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, RECHECK_INTERVAL_MS)
}

/** unpacked-run simulation: real window + IPC, fake download that completes */
function initFakeUpdate(getWindow: () => BrowserWindow | null, version: string): void {
  let timer: NodeJS.Timeout | null = null
  const actions = {
    onDownload: () => {
      let pct = 0
      pushUpdateState({ phase: 'downloading', percent: 0 })
      timer = setInterval(() => {
        pct += 4
        if (pct >= 100) {
          if (timer) clearInterval(timer)
          pushUpdateState({ phase: 'downloaded', percent: 100 })
        } else {
          pushUpdateState({ phase: 'downloading', percent: pct })
        }
      }, 100)
    },
    onInstall: () => {
      log('[fake] install requested')
      closeUpdateWindow()
    },
    onLater: () => {
      if (timer) clearInterval(timer)
      closeUpdateWindow()
    },
    onOpenDownload: () => {
      log('[fake] open download page requested')
    },
  }
  fakeShowAgain = () => showUpdateWindow(getWindow(), initialState(version, 'nsis'), actions)
  setTimeout(() => fakeShowAgain?.(), 1500)
}
