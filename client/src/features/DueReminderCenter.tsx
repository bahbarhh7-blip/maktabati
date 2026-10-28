import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, CalendarClock, Check, Clock3, ExternalLink, ShieldCheck } from "lucide-react";
import type { Book } from "@/lib/models";
import { getLoanReminders, localCalendarDate } from "@/lib/dueReminders";
import { translate, type AppLanguage } from "@/lib/i18n";

type Props = { books: Book[]; userId: number; language: AppLanguage; previewOnly?: boolean; onOpenBook: (book: Book) => void };
function dueLabel(daysLeft: number, language: AppLanguage) {
  if (daysLeft < 0) return `${translate("متأخر", language)} ${Math.abs(daysLeft)} ${translate("يوم", language)}`;
  if (daysLeft === 0) return translate("موعد الإرجاع اليوم", language);
  if (daysLeft === 1) return translate("موعد الإرجاع غداً", language);
  return `${translate("باقٍ", language)} ${daysLeft} ${translate("أيام", language)}`;
}

export default function DueReminderCenter({ books, userId, language, previewOnly = false, onOpenBook }: Props) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const [notice, setNotice] = useState("");
  const [today, setToday] = useState(localCalendarDate());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localCalendarDate()), 60_000);
    const refresh = () => setToday(localCalendarDate());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const reminders = useMemo(() => getLoanReminders(books, today), [books, today]);
  const actionable = useMemo(() => reminders.filter(item => item.daysLeft <= 1), [reminders]);

  useEffect(() => {
    if (previewOnly || permission !== "granted" || actionable.length === 0 || typeof window === "undefined") return;
    const key = `maktabati:due-notifications:${userId}`;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(key) || "[]") as string[]; } catch { seen = []; }
    const fresh = actionable.filter(({ book, daysLeft }) => {
      const phase = daysLeft < 0 ? `overdue-${today}` : daysLeft === 0 ? "due-today" : "due-tomorrow";
      return !seen.includes(`${book.id}:${book.dueAt}:${phase}`);
    });
    if (!fresh.length) return;
    const title = translate("تذكير بمواعيد الإرجاع", language);
    const body = `${fresh.length} ${translate("كتب لها موعد إرجاع قريب أو فائت.", language)}`;
    let cancelled = false;
    void (async () => {
      try {
        const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
        if (cancelled) return;
        if (registration) await registration.showNotification(title, { body, tag: `maktabati-loans-${userId}-${today}`, icon: "/maktabati-icon-192.png", data: { url: "/" } });
        else new Notification(title, { body, tag: `maktabati-loans-${userId}-${today}` });
        const updated = [...seen, ...fresh.map(({ book, daysLeft }) => `${book.id}:${book.dueAt}:${daysLeft < 0 ? `overdue-${today}` : daysLeft === 0 ? "due-today" : "due-tomorrow"}`)].slice(-120);
        localStorage.setItem(key, JSON.stringify(updated));
      } catch (error) { console.warn("[Maktabati reminders] notification unavailable", error); }
    })();
    return () => { cancelled = true; };
  }, [permission, actionable, language, today, userId, previewOnly]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) { setPermission("unsupported"); setNotice(translate("هذا المتصفح لا يدعم إشعارات الجهاز.", language)); return; }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      setNotice(result === "granted" ? translate("تم تفعيل إشعارات هذا الجهاز.", language) : result === "denied" ? translate("رُفض الإذن؛ يمكنك تغييره من إعدادات المتصفح.", language) : translate("لم يُمنح إذن الإشعارات.", language));
    } catch { setNotice(translate("تعذر طلب إذن الإشعارات.", language)); }
  };
  const permissionLabel = permission === "granted" ? translate("إشعارات الجهاز مفعلة", language) : permission === "denied" ? translate("الإشعارات محظورة من المتصفح", language) : permission === "unsupported" ? translate("إشعارات الجهاز غير مدعومة", language) : translate("تفعيل إشعارات هذا الجهاز", language);

  return <div className="reminder-anchor">
    <button className={`icon-button reminder-trigger ${reminders.length ? "has-reminders" : ""}`} onClick={() => { setOpen(value => !value); setNotice(""); }} title={translate("تذكيرات الإعارة", language)} aria-label={translate("تذكيرات الإعارة", language)} aria-expanded={open}><Bell size={18} />{reminders.length > 0 && <span className="reminder-count">{reminders.length}</span>}</button>
    {open && <section className="reminder-popover" aria-label={translate("تذكيرات الإعارة", language)}>
      <header><div><span className="reminder-popover-icon"><BellRing size={17} /></span><div><b>{translate("تذكيرات الإعارة", language)}</b><small>{reminders.length} {translate("موعداً قريباً أو فائتاً", language)}</small></div></div><button className="reminder-close" onClick={() => setOpen(false)} aria-label={translate("إغلاق", language)}>×</button></header>
      {previewOnly ? <div className="reminder-permission"><ShieldCheck size={15} /><span>{translate("معاينة فقط؛ لن تُطلب صلاحية أو تُرسل إشعارات.", language)}</span></div> : <div className="reminder-permission"><ShieldCheck size={15} /><span>{permissionLabel}</span>{permission === "default" && <button onClick={() => void enableNotifications()}>{translate("تفعيل", language)}</button>}</div>}
      {notice && !previewOnly && <p className="reminder-notice">{notice}</p>}
      <div className="reminder-list">{reminders.length ? reminders.map(({ book, daysLeft }) => <article className={`reminder-item ${daysLeft < 0 ? "overdue" : daysLeft === 0 ? "due-today" : ""}`} key={`${book.id}-${book.dueAt}`}><span className="reminder-item-icon">{daysLeft < 0 ? <Clock3 size={16} /> : <CalendarClock size={16} />}</span><div><b>{book.title}</b><small>{book.borrower} · {dueLabel(daysLeft, language)}</small></div><button onClick={() => { setOpen(false); onOpenBook(book); }} aria-label={translate("فتح الكتاب", language)}><ExternalLink size={15} /></button></article>) : <div className="reminder-empty"><Check size={18} /><span>{translate("لا توجد مواعيد إرجاع قريبة.", language)}</span></div>}</div>
      <p className="reminder-footnote">{translate("تظهر الإشعارات داخل التطبيق؛ إشعار الجهاز يحتاج إذناً، وقد لا يعمل والتطبيق مغلق.", language)}</p>
    </section>}
  </div>;
}
