"use client";

import { useState, type FormEvent } from "react";
import { TaskList, type TaskRow } from "./OperationalDashboard";

const days = ["2026-11-10", "2026-11-11"] as const;
type Day = typeof days[number];
type Hours = {available: boolean; start: string; end: string};
type Schedule = {rows: TaskRow[]; conflicts: {job: string; code: string}[]; valid: boolean; blocked: boolean};
type Snapshot = {
  revision: number;
  expires: number;
  state: {
    properties: {id: string; name: string; duration: number}[];
    cleaners: {id: string; name: string; availability: Record<Day, Hours>}[];
    reservations: {id: string; property_id: string; checkin: string; checkout: string; status: string}[];
    days: Record<Day, {preview: Schedule | null; published: Schedule | null; stale: boolean; pins: Record<string, string>}>;
  };
};
type Action = Record<string, string | boolean | number | null>;
const format = (value: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(value));
const conflictText: Record<string, string> = {
  NO_CAPACITY: "No cleaner has enough available capacity.",
  VALIDATION_FAILED: "The schedule failed its feasibility check.",
};

export function Playground() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [day, setDay] = useState<Day>(days[0]);
  const [tab, setTab] = useState("Schedule");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function request(action?: Action, success = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(action ? "/playground/api/mutate" : "/playground/api/session", {
        method: "POST",
        ...(action && {
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({...action, revision: snapshot?.revision}),
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
  }

  function save(event: FormEvent<HTMLFormElement>, action: (form: FormData) => Action, message: string) {
    event.preventDefault();
    void request(action(new FormData(event.currentTarget)), message);
  }

  const state = snapshot?.state;
  const current = state?.days[day];
  const schedule = current?.preview ?? current?.published;
  const propertyName = (id: string) => state?.properties.find(property => property.id === id)?.name ?? id;

  return <main className="playground cleaning-dashboard">
    <header className="playground-header">
      <div><span className="badge">Sandbox</span><h1>Lucena Systems Playground</h1>
        <p>Run a cleaning day with 12 fictional properties and 6 fictional cleaners.</p></div>
      <a className="playground-call" href="https://calendly.com/tyler-lucenasystems/lucena-systems-airbnb-operations-discovery-call">Book a Call ↗</a>
    </header>
    <p className="playground-boundary">Scheduling is available here. Maintenance and guest messaging are planned. All activity is simulated.</p>
    {error && <p role="alert" className="playground-error">{error}</p>}
    <p role="status" className="playground-status">{notice}</p>
    {!snapshot || !state ? <button type="button" disabled={busy} onClick={() => void request(undefined, "Sandbox ready.")}>{busy ? "Opening…" : "Open my sandbox"}</button> : <>
      <div className="playground-toolbar">
        <div role="group" aria-label="Sandbox workspace">
          {["Schedule", "Properties", "Cleaners", "Reservations"].map(name => <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
        </div>
        <div>
          <button type="button" disabled={busy} onClick={() => void request(undefined, "Sandbox refreshed.")}>Refresh</button>
          <button type="button" disabled={busy} onClick={() => {if (window.confirm("Restore the fictional starting data and erase your changes?")) void request({action: "reset"}, "Sandbox reset.");}}>Reset sandbox</button>
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
            <button type="button" onClick={() => void request({action: "generate", day}, "Preview generated.")}>Generate preview</button>
            <button type="button" disabled={!current?.preview?.valid || current.preview.blocked} onClick={() => void request({action: "publish", day}, "Simulated schedule published.")}>Publish simulation</button>
            <strong>{current?.preview ? "Preview" : current?.stale ? "Published plan · changes pending" : current?.published ? "Published simulation" : "No schedule yet"}</strong>
          </div>
          {schedule && <><TaskList tasks={schedule.rows} />
            <h2>Conflicts</h2>
            {schedule.conflicts.length ? <ul>{schedule.conflicts.map(conflict => <li key={conflict.job}><strong>{schedule.rows.find(row => row.id === conflict.job)?.property_name}</strong> · {current?.pins[conflict.job] ? "Manual assignment cannot fit the current shift or turnover window." : conflictText[conflict.code] ?? conflict.code.toLowerCase().replaceAll("_", " ")}</li>)}</ul> : <p>No conflicts in this plan.</p>}
            <h2>Assign jobs</h2>
            {current?.stale && !current.preview && <p>Generate a fresh preview to assign jobs.</p>}
            <div className="playground-edit-grid">{(!current?.stale || current.preview) && schedule.rows.map(row =>
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
            <button type="submit">Save property</button>
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
              <button type="submit">Save availability</button>
            </form>;
          })}
        </section>}
        {tab === "Reservations" && <section className="cleaning-table-wrap" aria-label="Fictional reservations"><table className="cleaning-table">
          <thead><tr><th>Property</th><th>Check-in (ET)</th><th>Checkout (ET)</th><th>Status</th></tr></thead>
          <tbody>{state.reservations.map(stay => <tr key={stay.id}><th scope="row">{propertyName(stay.property_id)}</th><td>{format(stay.checkin)}</td><td>{format(stay.checkout)}</td><td>
            {stay.status === "canceled" ? "Canceled" : <button type="button" onClick={() => {if (window.confirm("Cancel this fictional reservation?")) void request({action: "cancel", id: stay.id}, "Reservation canceled. Generate a fresh schedule.");}}>Simulate cancellation</button>}
          </td></tr>)}</tbody>
        </table></section>}
      </fieldset>
    </>}
  </main>;
}
