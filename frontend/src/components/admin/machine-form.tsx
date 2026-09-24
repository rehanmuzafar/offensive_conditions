"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Box, Download, Server, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { adminApi } from "@/lib/admin-api";

type Delivery = "spawn" | "static_host" | "download";

/**
 * Creating a machine.
 *
 * The first question is how it reaches a player, because the answer decides
 * what else the form even asks for. Spinning up a container per player needs an
 * image and a registry; an always-on VPS needs an address and nothing else; a
 * boot2root image needs a file and a checksum and never runs on our
 * infrastructure at all.
 *
 * Showing all three sets at once — the shape this form would take if delivery
 * were just another field — is how a machine gets saved with an image it will
 * never use and no address anyone can reach.
 */
export function MachineForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [delivery, setDelivery] = useState<Delivery>("spawn");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [os, setOs] = useState("linux");
  const [difficulty, setDifficulty] = useState("easy");
  const [userPoints, setUserPoints] = useState("20");
  const [rootPoints, setRootPoints] = useState("30");

  const [imageRef, setImageRef] = useState("");
  const [imageVersion, setImageVersion] = useState("v1.0");
  const [staticHost, setStaticHost] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [sha, setSha] = useState("");
  const [sizeGb, setSizeGb] = useState("");
  const [format, setFormat] = useState("ova");

  const create = useMutation({
    mutationFn: () =>
      adminApi.createMachine({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        os,
        difficulty,
        delivery,
        base_user_points: Number(userPoints) || 0,
        base_root_points: Number(rootPoints) || 0,
        ...(delivery === "spawn"
          ? { backend: "container" as const, image_ref: imageRef.trim(), image_version: imageVersion.trim() }
          : {}),
        ...(delivery === "static_host" ? { static_host: staticHost.trim() } : {}),
        ...(delivery === "download"
          ? {
              download_url: downloadUrl.trim(),
              download_sha256: sha.trim() || null,
              download_format: format.trim() || null,
              // Entered in GB because that is how these images are sized;
              // stored in bytes so the UI never has to guess a unit.
              download_size_bytes: sizeGb ? Math.round(Number(sizeGb) * 1024 ** 3) : null,
            }
          : {}),
      }),
    onSuccess: () => {
      toast.success(`Created "${name}"`);
      onCreated();
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not create that machine."),
  });

  function submit() {
    if (!name.trim() || !slug.trim()) return toast.error("A machine needs a name and a slug.");
    if (delivery === "spawn" && !imageRef.trim()) return toast.error("A spawned machine needs an image.");
    if (delivery === "static_host" && !staticHost.trim())
      return toast.error("A static host needs the address players attack.");
    if (delivery === "download" && !downloadUrl.trim())
      return toast.error("A boot2root machine needs the image players download.");
    create.mutate();
  }

  const field =
    "h-10 w-full border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none";
  const label = "mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-text-faint";

  const KINDS: { value: Delivery; icon: typeof Box; title: string; blurb: string }[] = [
    { value: "spawn", icon: Box, title: "Spawned", blurb: "A container per player, brought up on demand." },
    { value: "static_host", icon: Server, title: "Static host", blurb: "One always-on VPS everyone attacks." },
    { value: "download", icon: Download, title: "Boot2root", blurb: "An image players run on their own hardware." },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="New machine"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex max-h-[88vh] w-full max-w-[640px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">New machine</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              How it reaches players decides the rest of this form.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = delivery === k.value;
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setDelivery(k.value)}
                  className={cn(
                    "border px-3.5 py-3 text-left transition-colors",
                    active ? "border-accent bg-surface-hover" : "border-line hover:border-line-strong",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-accent" : "text-text-faint")} />
                  <span className="mt-2 block text-[13px] font-semibold text-text">{k.title}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-text-faint">{k.blurb}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Name</label>
              <input
                className={field}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Slug follows the name until someone edits it by hand.
                  if (!slug || slug === toSlug(name)) setSlug(toSlug(e.target.value));
                }}
              />
            </div>
            <div>
              <label className={label}>Slug</label>
              <input className={cn(field, "font-mono")} value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={label}>Description</label>
            <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className={label}>OS</label>
              <select className={field} value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={label}>Difficulty</label>
              <select className={field} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="insane">Insane</option>
              </select>
            </div>
            <div>
              <label className={label}>User pts</label>
              <input className={field} value={userPoints} inputMode="numeric" onChange={(e) => setUserPoints(e.target.value)} />
            </div>
            <div>
              <label className={label}>Root pts</label>
              <input className={field} value={rootPoints} inputMode="numeric" onChange={(e) => setRootPoints(e.target.value)} />
            </div>
          </div>

          {delivery === "spawn" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label className={label}>Container image</label>
                <input
                  className={cn(field, "font-mono")}
                  value={imageRef}
                  placeholder="harbor.offensiveconditions.org/machines/box"
                  onChange={(e) => setImageRef(e.target.value)}
                />
              </div>
              <div>
                <label className={label}>Version</label>
                <input className={cn(field, "font-mono")} value={imageVersion} onChange={(e) => setImageVersion(e.target.value)} />
              </div>
            </div>
          )}

          {delivery === "static_host" && (
            <div>
              <label className={label}>Address players attack</label>
              <input
                className={cn(field, "font-mono")}
                value={staticHost}
                placeholder="10.10.20.5  ·  box.offensiveconditions.org"
                onChange={(e) => setStaticHost(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-text-faint">
                Nothing is spawned for this kind — every player hits this host.
              </p>
            </div>
          )}

          {delivery === "download" && (
            <div className="space-y-4">
              <div>
                <label className={label}>Image URL</label>
                <input
                  className={cn(field, "font-mono")}
                  value={downloadUrl}
                  placeholder="https://…/box.ova"
                  onChange={(e) => setDownloadUrl(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_120px_120px]">
                <div>
                  <label className={label}>SHA-256</label>
                  <input className={cn(field, "font-mono")} value={sha} onChange={(e) => setSha(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Size (GB)</label>
                  <input className={field} value={sizeGb} inputMode="decimal" onChange={(e) => setSizeGb(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Format</label>
                  <select className={field} value={format} onChange={(e) => setFormat(e.target.value)}>
                    <option value="ova">OVA</option>
                    <option value="ovf">OVF</option>
                    <option value="vmdk">VMDK</option>
                    <option value="qcow2">qcow2</option>
                    <option value="iso">ISO</option>
                  </select>
                </div>
              </div>
              <p className="text-[11.5px] text-text-faint">
                The checksum is published beside the download — players run this
                image with full privileges on their own hardware, so being able
                to verify it matters.
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            Create machine
          </Button>
        </footer>
      </div>
    </div>
  );
}

function toSlug(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
