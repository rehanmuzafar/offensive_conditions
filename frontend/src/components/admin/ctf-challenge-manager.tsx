"use client";

/**
 * Challenge management for one CTF event.
 *
 * The flag is hashed with SHA-256 in the browser and only the digest is sent —
 * ctf-svc stores `static_flag_hash` and never sees the plaintext, so nothing
 * recoverable is written to the database or the request log.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flag, Loader2, Paperclip, Pencil, Plus, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  ctfAdminApi,
  hashFlag,
  uploadChallengeFile,
  type AdminCtfChallenge,
  type ChallengeFile,
  type CtfChallengeInput,
  type DeliveryType,
} from "@/lib/ctf-admin-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

const DELIVERY_LABEL: Record<DeliveryType, string> = {
  static: "static",
  shared_host: "shared host",
  per_player: "per-player spawn",
};

const CATEGORIES = ["web", "pwn", "crypto", "reverse", "forensics", "osint", "misc"];
const DIFFICULTIES = ["very_easy", "easy", "medium", "hard", "insane"];

interface Hint {
  text: string;
  cost: number;
}

export function CtfChallengeManager({
  eventId,
  eventName,
  runtime = "static_only",
}: {
  eventId: string;
  eventName: string;
  /** Event-level setting — per-player spawning is unavailable when static_only. */
  runtime?: "cloud" | "onsite" | "static_only";
}) {
  const [items, setItems] = useState<AdminCtfChallenge[]>([]);
  /** Challenge awaiting a second click to confirm deletion. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("web");
  const [difficulty, setDifficulty] = useState("easy");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState(100);
  const [flag, setFlag] = useState("");
  const [hints, setHints] = useState<Hint[]>([]);
  const [delivery, setDelivery] = useState<DeliveryType>("static");
  const [connectionUrl, setConnectionUrl] = useState("");
  const [imageRef, setImageRef] = useState("");
  const [files, setFiles] = useState<ChallengeFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await ctfAdminApi.listChallenges(eventId);
      setItems(res.items ?? []);
    } catch {
      toast.error("Could not load challenges");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function reset() {
    setName(""); setDescription(""); setFlag(""); setPoints(100);
    setCategory("web"); setDifficulty("easy"); setHints([]);
    setDelivery("static"); setConnectionUrl(""); setImageRef(""); setFiles([]);
    setEditingId(null);
  }

  function startEdit(c: AdminCtfChallenge) {
    setEditingId(c.id);
    setName(c.name);
    setCategory(c.category);
    setDifficulty(c.difficulty || "easy");
    setDescription(c.description);
    setPoints(c.base_points);
    setDelivery(c.delivery_type);
    setConnectionUrl(c.connection_url ?? "");
    setImageRef(c.image_ref ?? "");
    setFiles(c.files ?? []);
    // The flag hash is write-only; leaving this blank keeps the existing flag.
    setFlag("");
    setHints([]);
    setShowForm(true);
  }

  async function addFile(file: File) {
    setUploadingFile(true);
    try {
      const uploaded = await uploadChallengeFile(file);
      setFiles((prev) => [...prev, uploaded]);
      toast.success(`Attached ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingFile(false);
    }
  }

  async function submit() {
    if (name.trim().length < 2) return toast.error("Challenge needs a name");
    if (!description.trim()) return toast.error("Challenge needs a description");
    // On edit an empty flag means "keep the existing one" — the hash is
    // write-only so there is nothing to prefill.
    if (!editingId && !flag.trim()) return toast.error("Challenge needs a flag");
    if (points < 10) return toast.error("Points must be at least 10");
    if (delivery === "shared_host" && !connectionUrl.trim())
      return toast.error("A shared-host challenge needs the address players connect to");
    if (delivery === "per_player" && !imageRef.trim())
      return toast.error("A per-player challenge needs a container image");

    setSaving(true);
    try {
      const body: CtfChallengeInput = {
        name: name.trim(),
        category,
        difficulty,
        description: description.trim(),
        base_points: points,
        delivery_type: delivery,
        /* Saved whatever the delivery type is. It used to be nulled unless the
           challenge was "shared host", so an author who uploaded files *and*
           pasted a web link silently lost the link — the field was only ever
           rendered for one of the three types. It is required for shared_host
           and optional everywhere else. */
        connection_url: connectionUrl.trim() || null,
        image_ref: delivery === "per_player" ? imageRef.trim() : null,
        files,
        ...(flag.trim() ? { static_flag_hash: await hashFlag(flag.trim()) } : {}),
        flag_pattern: "OFFCON{...}",
        hints: hints
          .filter((h) => h.text.trim())
          .map((h, i) => ({ id: `hint-${i + 1}`, text: h.text.trim(), point_deduction: h.cost })),
      };
      if (editingId) {
        await ctfAdminApi.updateChallenge(eventId, editingId, body);
        toast.success(`Updated “${name.trim()}”`);
      } else {
        await ctfAdminApi.createChallenge(eventId, body);
        toast.success(`Added “${name.trim()}”`);
      }
      reset();
      setShowForm(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the challenge");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-[16px] font-bold">
            <Flag className="h-4 w-4 text-accent" /> Challenges — {eventName}
          </h3>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-[18px] w-[18px]" /> Add challenge
          </Button>
        </div>

        {showForm && (
          <div className="space-y-4 rounded-xl border border-line bg-bg-elevated/50 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Name</label>
                <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Login Bypass" />
              </div>
              <div>
                <label className={label}>Points</label>
                <input type="number" min={10} className={field} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
              </div>
              <div>
                <label className={label}>Category</label>
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Difficulty</label>
                <select className={field} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.replace("_", " ")}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={label}>Description</label>
              <textarea
                className={`${field} h-24 py-2`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the player sees. For a shared-host challenge, put the URL here — e.g. http://192.168.100.14:8001"
              />
            </div>

            {/* how the challenge reaches the player */}
            <div className="rounded-xl border border-line bg-bg/40 p-3">
              <label className={label}>Delivery</label>
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-[14px]">
                  <input type="radio" className="mt-1" checked={delivery === "static"} onChange={() => setDelivery("static")} />
                  <span>
                    <span className="font-semibold">Static</span>
                    <span className="block text-[12px] text-text-faint">
                      No service — the player works from the attached files. Crypto, reverse, forensics.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[14px]">
                  <input type="radio" className="mt-1" checked={delivery === "shared_host"} onChange={() => setDelivery("shared_host")} />
                  <span>
                    <span className="font-semibold">Shared host</span>
                    <span className="block text-[12px] text-text-faint">
                      One instance everyone attacks at a fixed address. The usual choice for web and pwn.
                    </span>
                  </span>
                </label>
                <label className={cnRadio(runtime === "static_only")}>
                  <input
                    type="radio"
                    className="mt-1"
                    disabled={runtime === "static_only"}
                    checked={delivery === "per_player"}
                    onChange={() => setDelivery("per_player")}
                  />
                  <span>
                    <span className="font-semibold">Per-player spawn</span>
                    <span className="block text-[12px] text-text-faint">
                      {runtime === "static_only"
                        ? "Unavailable — set the event to run challenges on cloud or on-site first."
                        : "Each player gets their own instance and address, HackTheBox style."}
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-3">
                  <label className={label}>
                    Link players open{delivery === "shared_host" ? "" : " (optional)"}
                  </label>
                  <input className={field} value={connectionUrl} onChange={(e) => setConnectionUrl(e.target.value)} placeholder="http://203.0.113.10:8001" />
                </div>
              {delivery === "per_player" && (
                <div className="mt-3">
                  <label className={label}>Container image</label>
                  <input className={field} value={imageRef} onChange={(e) => setImageRef(e.target.value)} placeholder="registry.offensiveconditions.org/challenges/babyrop:v1" />
                </div>
              )}
            </div>

            {/* attachments — available for every delivery type */}
            <div>
              <label className={label}>Attachments</label>
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2 text-[13px] hover:border-accent">
                  {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploadingFile ? "Uploading…" : "Add file"}
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void addFile(f);
                    }}
                  />
                </label>
                <span className="text-[12px] text-text-faint">
                  Scenario files, binaries, packet captures — checksummed on upload.
                </span>
              </div>
              {files.map((f, i) => (
                <div key={f.sha256 + i} className="mt-2 flex items-center gap-2 text-[13px]">
                  <Paperclip className="h-3.5 w-3.5 text-text-faint" />
                  <span className="text-text">{f.name}</span>
                  <span className="text-text-faint">{(f.size_bytes / 1024).toFixed(0)} KB</span>
                  <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-text-faint hover:text-danger" aria-label="Remove file">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div>
              <label className={label}>Flag</label>
              <input
                className={field}
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                placeholder={editingId ? "Leave blank to keep the current flag" : "OFFCON{...}"}
              />
              <p className="mt-1.5 text-[12px] text-text-faint">
                Hashed with SHA-256 in your browser — the plaintext flag never leaves this page.
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className={label}>Hints (optional)</label>
                <button
                  onClick={() => setHints((h) => [...h, { text: "", cost: 10 }])}
                  className="text-[12px] font-semibold text-accent hover:underline"
                >
                  + Add hint
                </button>
              </div>
              {hints.map((h, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input
                    className={field}
                    value={h.text}
                    placeholder="Hint text"
                    onChange={(e) => setHints((prev) => prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))}
                  />
                  <input
                    type="number"
                    min={0}
                    className={`${field} w-28`}
                    value={h.cost}
                    title="Point cost"
                    onChange={(e) => setHints((prev) => prev.map((p, j) => (j === i ? { ...p, cost: Number(e.target.value) } : p)))}
                  />
                  <button onClick={() => setHints((prev) => prev.filter((_, j) => j !== i))} className="text-text-faint hover:text-danger" aria-label="Remove hint">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowForm(false); reset(); }}>
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Save changes" : "Add challenge"}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-[14px] text-text-dim">Loading challenges…</p>
        ) : items.length === 0 ? (
          <p className="text-[14px] text-text-dim">No challenges yet. Add at least one before publishing.</p>
        ) : (
          <div className="divide-y divide-line">
            {items.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-text">{c.name}</p>
                  <p className="text-[12px] text-text-faint">
                    {c.category} · {c.difficulty.replace("_", " ")} · {DELIVERY_LABEL[c.delivery_type]}
                    {c.connection_url ? ` · ${c.connection_url}` : ""} · {c.total_solves} solves
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-[15px] font-bold text-accent">
                    {c.current_points ?? c.base_points} pts
                  </span>
                  <Button variant="ghost" onClick={() => startEdit(c)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  {/* Two-step. The confirm names the challenge, because in a
                      list of similar rows the dangerous mistake is deleting the
                      one next to the one you meant. */}
                  <Button
                    variant="danger"
                    loading={removing === c.id}
                    onClick={() => {
                      if (confirmingDelete !== c.id) {
                        setConfirmingDelete(c.id);
                        return;
                      }
                      setRemoving(c.id);
                      ctfAdminApi
                        .deleteChallenge(eventId, c.id)
                        .then(() => {
                          toast.success(`Deleted "${c.name}"`);
                          setConfirmingDelete(null);
                          void load();
                        })
                        .catch((err) =>
                          toast.error(
                            err instanceof Error ? err.message : "Could not delete that challenge.",
                          ),
                        )
                        .finally(() => setRemoving(null));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {confirmingDelete === c.id ? "Confirm" : "Delete"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}


/** Dims the per-player row when the event has no runtime configured. */
function cnRadio(disabled: boolean): string {
  return disabled
    ? "flex items-start gap-2 text-[14px] opacity-50 cursor-not-allowed"
    : "flex items-start gap-2 text-[14px]";
}
