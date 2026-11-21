"use client";

import { CalendarDays, Check, House, RefreshCw, RotateCcw, UsersRound, CalendarRange, Sparkles, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TaskList, type TaskRow } from "./OperationalDashboard";

const sections = {Schedule: CalendarDays, Properties: House, Cleaners: UsersRound, Reservations: CalendarRange};

const days = ["2026-11-10", "2026-11-11"] as const;
type Day = typeof days[number];
type Hours = {available: boolean; start: string; end: string};
type Schedule = {rows: TaskRow[]; conflicts: {job: string; code: string}[]; valid: boolean; blocked: boolean};
type Recovery = {job: string; property: string; original: string; status: "awaiting" | "accepted" | "uncovered"; replacement: TaskRow | null};
type Snapshot = {
  revision: number;
  expires: number;
  state: {
    properties: {id: string; name: string; duration: number}[];
    cleaners: {id: string; name: string; availability: Record<Day, Hours>}[];
    reservations: {id: string; property_id: string; checkin: string; checkout: string; status: string}[];
    days: Record<Day, {preview: Schedule | null; published: Schedule | null; stale: boolean; pins: Record<string, string>; recovery?: Recovery}>;
  };
};
type Action = Record<string, string | boolean | number | null>;
const format = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value));
const conflictText: Record<string, string> = {
  NO_CAPACITY: "No cleaner has enough available capacity.",
  CLEANER_CANCELED: "Cleaner canceled. This job is open until a replacement accepts.",
  VALIDATION_FAILED: "The schedule failed its feasibility check.",
};

export function Playground() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [day, setDay] = useState<Day>(days[0]);
  const [tab, setTab] = useState("Schedule");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (action?: Action, success = "", revision?: number) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(action ? "/playground/api/mutate" : "/playground/api/session", {
        method: "POST",
        ...(action && {
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({...action, revision}),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) setSnapshot(null);
        const result = await response.json().catch(() => null);
        throw new Error(result?.detail || "The sandbox is unavailable. Try again shortly.");
      }
      setSnapshot(await response.json());
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sandbox is unavailable.");
    } finally {
      setBusy(false);
    }
  }, []);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.resolve().then(() => load());
  }, [load]);

  function request(action?: Action, success = "") {
    return load(action, success, snapshot?.revision);
  }

  function save(event: FormEvent<HTMLFormElement>, action: (form: FormData) => Action, message: string) {
    event.preventDefault();
    void request(action(new FormData(event.currentTarget)), message);
  }

  const state = snapshot?.state;
  const current = state?.days[day];
  const recovery = current?.recovery;
  const awaiting = recovery?.status === "awaiting";
  const schedule = current?.preview ?? current?.published;
  const propertyName = (id: string) => state?.properties.find(property => property.id === id)?.name ?? id;

  return <main className="playground cleaning-dashboard">
    {error && <p role="alert" className="playground-error">{error}</p>}
    <p role="status" className="playground-status">{notice}</p>
    {!snapshot || !state ? <button className="playground-primary" type="button" disabled={busy} onClick={() => void request(undefined, "Sandbox ready.")}>{busy ? "Opening…" : "Open my sandbox"}</button> : <>
      <div className="playground-toolbar">
        <div className="playground-navigation" role="group" aria-label="Sandbox workspace">
          {Object.entries(sections).map(([name, Icon]) => <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}><Icon aria-hidden="true" /> {name}</button>)}
        </div>
        <div>
          <button type="button" disabled={busy} onClick={() => void request(undefined, "Sandbox refreshed.")}><RefreshCw aria-hidden="true" /> Refresh</button>
          <button className="playground-danger" type="button" disabled={busy} onClick={() => {if (window.confirm("Restore the fictional starting data and erase your changes?")) void request({action: "reset"}, "Sandbox reset.");}}><RotateCcw aria-hidden="true" /> Reset sandbox</button>
        </div>
      </div>
      <p className="muted">Session expires at {format(new Date(snapshot.expires * 1000).toISOString())} ET. Changes are saved in this browser session.</p>
      {(tab === "Schedule" || tab === "Cleaners") && <label className="playground-date">Service day (ET)
        <select value={day} onChange={event => setDay(event.target.value as Day)}>
          <option value={days[0]}>Tue, Nov 10</option><option value={days[1]}>Wed, Nov 11</option>
        </select>
      </label>}
      <fieldset disabled={busy} className="playground-content">
        <legend className="visually-hidden">{tab}</legend>
        {tab === "Schedule" && <section aria-label="Simulated schedule">
          <div className="playground-actions">
            <button type="button" disabled={awaiting} onClick={() => void request({action: "generate", day}, "Preview generated.")}><Sparkles aria-hidden="true" /> Generate preview</button>
            <button className="playground-primary" type="button" disabled={!current?.preview?.valid || current.preview.blocked} onClick={() => void request({action: "publish", day}, "Simulated schedule published.")}><Send aria-hidden="true" /> Publish simulation</button>
            <strong>{current?.preview ? "Preview" : current?.stale ? "Published plan · changes pending" : current?.published ? "Published simulation" : "No schedule yet"}</strong>
          </div>
          {schedule && <><TaskList tasks={schedule.rows} />
            {current?.published && !current.preview && !current.stale && <section aria-label="Cleaner cancellation recovery">
              <h2>Cleaner cancellation</h2>
              {recovery && <div className="playground-edit-grid"><div>
                <p role="status">{recovery.original} canceled at {recovery.property}. {recovery.status === "uncovered"
                  ? "No replacement could cover this job. Manager action needed."
                  : recovery.replacement && (awaiting
                    ? `${recovery.replacement.cleaner_name} can cover it. Waiting for acceptance.`
                    : `${recovery.replacement.cleaner_name} accepted the replacement.`)}</p>
                {awaiting && <div className="playground-actions">
                  <button className="playground-primary" type="button" onClick={() => void request({action: "replacement_accept", day, id: recovery.job})}>Simulate acceptance</button>
                  <button type="button" onClick={() => void request({action: "replacement_decline", day, id: recovery.job})}>Simulate decline</button>
                </div>}
              </div></div>}
              {!awaiting && schedule.rows.some(row => row.cleaner_name) && <form className="playground-actions" onSubmit={event => save(event, form => ({action: "cleaner_cancel", day, id: String(form.get("job"))}), "")}>
                <label>Published job <select name="job" required>
                  {schedule.rows.filter(row => row.cleaner_name).map(row => <option key={row.id} value={row.id}>{row.property_name} · {row.cleaner_name}</option>)}
                </select></label>
                <button className="playground-danger" type="submit">Simulate cleaner cancellation</button>
              </form>}
            </section>}
            <h2>Conflicts</h2>
            {schedule.conflicts.length ? <ul>{schedule.conflicts.map(conflict => <li key={conflict.job}><strong>{schedule.rows.find(row => row.id === conflict.job)?.property_name}</strong> · {current?.pins[conflict.job] ? "Manual assignment cannot fit the current shift or turnover window." : conflictText[conflict.code] ?? conflict.code.toLowerCase().replaceAll("_", " ")}</li>)}</ul> : <p>No conflicts in this plan.</p>}
            <h2>Assign jobs</h2>
            {current?.stale && !current.preview && <p>Generate a fresh preview to assign jobs.</p>}
            <div className="playground-edit-grid">{!awaiting && (!current?.stale || current.preview) && schedule.rows.map(row =>
              <form key={`${snapshot.revision}-${row.id}`} onSubmit={event => save(event, form => {
                const value = String(form.get("cleaner"));
                return {action: "assign", day, id: row.id, cleaner_id: value || null};
              }, "Assignment preview updated.")}>
                <label>{row.property_name}<select name="cleaner" defaultValue={current?.pins[row.id] ?? ""}>
                  <option value="">Automatic assignment</option>
                  {state.cleaners.map(cleaner => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}
                </select></label><button type="submit">Apply</button>
              </form>)}</div>
          </>}
        </section>}
        {tab === "Properties" && <section className="playground-edit-grid" aria-label="Fictional properties">
          {state.properties.map(property => <form key={`${snapshot.revision}-${property.id}`} onSubmit={event => save(event, form => ({action: "property", id: property.id, name: String(form.get("name")), duration: Number(form.get("duration"))}), "Property saved.")}>
            <label>Fictional property name<input name="name" defaultValue={property.name} minLength={1} maxLength={48} required /></label>
            <label>Cleaning minutes<input name="duration" type="number" min={30} max={360} defaultValue={property.duration} required /></label>
            <button className="playground-primary" type="submit"><Check aria-hidden="true" /> Save property</button>
          </form>)}
        </section>}
        {tab === "Cleaners" && <section className="playground-edit-grid" aria-label="Cleaner availability">
          {state.cleaners.map(cleaner => {
            const hours = cleaner.availability[day];
            return <form key={`${snapshot.revision}-${day}-${cleaner.id}`} onSubmit={event => save(event, form => ({action: "availability", day, id: cleaner.id, available: form.has("available"), start: String(form.get("start")), end: String(form.get("end"))}), "Availability saved.")}>
              <h2>{cleaner.name}</h2>
              <label className="playground-check"><input type="checkbox" name="available" defaultChecked={hours.available} /> Available</label>
              <label>Shift starts<input type="time" name="start" defaultValue={hours.start} required /></label>
              <label>Shift ends<input type="time" name="end" defaultValue={hours.end} required /></label>
              <button className="playground-primary" type="submit"><Check aria-hidden="true" /> Save availability</button>
            </form>;
          })}
        </section>}
        {tab === "Reservations" && <section className="cleaning-table-wrap" aria-label="Fictional reservations"><table className="cleaning-table">
          <thead><tr><th>Property</th><th>Check-in (ET)</th><th>Checkout (ET)</th><th>Status</th></tr></thead>
          <tbody>{state.reservations.map(stay => <tr key={stay.id}><th scope="row">{propertyName(stay.property_id)}</th><td>{format(stay.checkin)}</td><td>{format(stay.checkout)}</td><td>
            {stay.status === "canceled" ? "Canceled" : <button className="playground-danger" type="button" onClick={() => {if (window.confirm("Cancel this fictional reservation?")) void request({action: "cancel", id: stay.id}, "Reservation canceled. Generate a fresh schedule.");}}>Simulate cancellation</button>}
          </td></tr>)}</tbody>
        </table></section>}
      </fieldset>
    </>}
  </main>;
}
