"use client";

// Category management — ADMIN ONLY. Employees are routed to the shared
// Projects browser (RLS independently blocks their category writes).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { CategoryFormModal } from "@/components/categories/CategoryFormModal";
import { useMember } from "@/components/MemberProvider";
import { deleteCategory, getProjectTotals, listCategories, listProjects } from "@/lib/api";
import { secsToHM } from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, Project } from "@/lib/types";

export default function CategoriesPage() {
  const member = useMember();
  const router = useRouter();
  const isAdmin = member.role === "admin";

  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  useEffect(() => {
    if (!isAdmin) router.replace("/projects");
  }, [isAdmin, router]);

  const reload = useCallback(async () => {
    try {
      // PERF: totals come from the aggregate view — no raw session rows.
      const [c, p, t] = await Promise.all([listCategories(), listProjects(), getProjectTotals()]);
      setCategories(c);
      setProjects(p);
      setTotals(t);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) reload();
  }, [isAdmin, reload]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; seconds: number }>();
    for (const cat of categories) map.set(cat.id, { count: 0, seconds: 0 });
    for (const p of projects) {
      const entry = map.get(p.category_id);
      if (!entry) continue;
      entry.count += 1;
      entry.seconds += totals.get(p.id) ?? 0;
    }
    return map;
  }, [categories, projects, totals]);

  async function onDelete(cat: Category) {
    if (!confirm(`Delete "${cat.name}" and all its projects & time history? This cannot be undone.`)) return;
    await track(deleteCategory(cat.id));
    reload();
  }

  if (!isAdmin) return null;

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Organize the organization's projects into containers."
        right={
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus size={16} /> New category
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : err ? (
        <div className="card p-6 text-sm text-red-500">{err}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((cat) => {
            const stat = byCategory.get(cat.id) ?? { count: 0, seconds: 0 };
            return (
              <div key={cat.id} className="group relative">
                <Link
                  href={`/categories/${cat.id}`}
                  className="card flex h-full flex-col gap-3 p-4 transition hover:-translate-y-0.5"
                >
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                    style={{ background: cat.color }}
                  >
                    <CategoryIcon icon={cat.icon} size={22} />
                  </div>
                  <div>
                    <p className="line-clamp-2 font-semibold leading-tight">{cat.name}</p>
                    <p className="muted mt-1 text-xs">
                      {stat.count} project{stat.count === 1 ? "" : "s"} · {secsToHM(stat.seconds)}
                    </p>
                  </div>
                </Link>
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    className="rounded-lg bg-[var(--surface-2)] p-1.5 hover:brightness-95"
                    onClick={() => {
                      setEditing(cat);
                      setModalOpen(true);
                    }}
                    aria-label="Edit category"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="rounded-lg bg-[var(--surface-2)] p-1.5 text-red-500 hover:brightness-95"
                    onClick={() => onDelete(cat)}
                    aria-label="Delete category"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-sm font-medium muted transition hover:border-brand hover:text-brand"
            style={{ borderColor: "var(--border)" }}
          >
            <Plus size={22} />
            New category
          </button>
        </div>
      )}

      {categories.length === 0 && !loading && !err && (
        <div className="card mt-4 p-8 text-center">
          <p className="font-semibold">No categories yet</p>
          <p className="muted mt-1 text-sm">Create your first category to start adding projects.</p>
        </div>
      )}

      <CategoryFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={reload}
        editing={editing}
      />
    </div>
  );
}
