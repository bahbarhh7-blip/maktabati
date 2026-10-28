import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { translate, type AppLanguage } from "@/lib/i18n";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<InstallChoice> };

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}
function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export default function PwaInstallButton({ language }: { language: AppLanguage }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && isStandalone());
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const handleInstalled = () => { setInstalled(true); setInstallPrompt(null); setHelpOpen(false); };
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const install = async () => {
    setNotice("");
    if (!installPrompt) { setHelpOpen(true); return; }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setNotice(translate("سيظهر مكتبتي كتطبيق على جهازك.", language));
    } catch {
      setNotice(translate("تعذر فتح نافذة التثبيت؛ استخدم قائمة المتصفح لإضافة التطبيق.", language));
    }
  };

  if (installed) return null;

  return <>
    <button type="button" className="outline-button install-app-button" onClick={() => void install()} title={translate("تثبيت التطبيق", language)} aria-label={translate("تثبيت التطبيق", language)}>
      <Download size={16} /><span>{translate("تثبيت التطبيق", language)}</span>
    </button>
    {notice && <div className="install-toast" role="status">{notice}</div>}
    {helpOpen && <div className="modal-backdrop install-help-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
      <section className="modal install-help-modal" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
        <header className="modal-heading"><span className="install-help-icon"><Download size={20} /></span><div><h2 id="install-help-title">{translate("طريقة تثبيت مكتبتي", language)}</h2><p>{translate("أضف مكتبتي إلى شاشة جهازك لفتحه كتطبيق مستقل.", language)}</p></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label={translate("إغلاق", language)}><X size={18} /></button></header>
        {isAppleMobile() ? <ol className="install-steps"><li>{translate("افتح قائمة المشاركة في Safari.", language)}</li><li>{translate("اختر إضافة إلى الشاشة الرئيسية.", language)}</li><li>{translate("اضغط إضافة لتثبيت مكتبتي.", language)}</li></ol> : <ol className="install-steps"><li>{translate("افتح قائمة المتصفح (⋮ أو ⋯).", language)}</li><li>{translate("اختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية.", language)}</li><li>{translate("أكد الإضافة؛ سيظهر مكتبتي بين تطبيقاتك.", language)}</li></ol>}
        <p className="install-help-note">{translate("قد تختلف أسماء الخيارات باختلاف المتصفح والجهاز.", language)}</p>
        <footer className="modal-footer"><button className="primary-button" onClick={() => setHelpOpen(false)}>{translate("حسناً", language)}</button></footer>
      </section>
    </div>}
  </>;
}
