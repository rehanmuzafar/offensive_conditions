"use client";

/**
 * Create-team dialog. Lives in a modal rather than inline on the list page so
 * the list stays a list.
 */

import { useState } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { COUNTRIES } from "@/lib/countries";
import { teamsApi } from "@/lib/teams-api";
import { field, label, slugifyTeam } from "@/components/teams/team-form-fields";

export function CreateTeamDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [categoryDetail, setCategoryDetail] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (name.trim().length < 3) return toast.error("Team name must be at least 3 characters");
    if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
      return toast.error("Slug must be 3–32 lowercase letters, digits or hyphens");
    }
    setSaving(true);
    try {
      await teamsApi.create({
        name: name.trim(),
        slug,
        description: description.trim(),
        category_detail: categoryDetail.trim() || undefined,
        country_code: countryCode || undefined,
      });
      toast.success(`Team “${name.trim()}” created`);
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto glass p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">Create a team</h2>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Team name</label>
              <input
                className={field}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || slug === slugifyTeam(name)) setSlug(slugifyTeam(e.target.value));
                }}
                placeholder="Alpha Squad"
              />
            </div>
            <div>
              <label className={label}>Slug</label>
              <input
                className={field}
                value={slug}
                onChange={(e) => setSlug(slugifyTeam(e.target.value))}
                placeholder="alpha-squad"
              />
            </div>
          </div>

          <div>
            <label className={label}>Description</label>
            <input
              className={field}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Country</label>
              <select
                className={field}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                <option value="">Not set</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Organisation / university</label>
              <input
                className={field}
                value={categoryDetail}
                onChange={(e) => setCategoryDetail(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create team
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
