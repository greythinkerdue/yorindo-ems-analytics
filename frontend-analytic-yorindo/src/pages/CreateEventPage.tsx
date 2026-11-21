import { useState, type FormEvent, type ReactNode } from "react"
import { useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import MainLayout from "@/components/Layout/MainLayout"
import Button from "@/components/Button"
import { useAuth } from "@/hooks/useAuth"
import { createEventRemote } from "@/store/eventSlice"
import type { AppDispatch } from "@/store/store"
import type { CreateEventDTO, Event } from "@/types/event"

const FIELD_CLASS =
  "h-11 w-full rounded-button border border-field bg-white px-3.5 text-sm text-neutral-800 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"

const TEXTAREA_CLASS =
  "min-h-[88px] w-full resize-none rounded-button border border-field bg-white px-3.5 py-2.5 text-sm text-neutral-800 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-primary focus:ring-2 focus:ring-primary/15"

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-semibold text-neutral-700">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-label="wajib">
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

const CreateEventPage = () => {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [form, setForm] = useState<CreateEventDTO>({
    title: "",
    description: "",
    event_date: "",
    location: "",
    status: "draft",
    max_capacity: 100,
  })

  const handleChange = <K extends keyof CreateEventDTO>(
    key: K,
    value: CreateEventDTO[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAuthenticated) return

    const result = await dispatch(
      createEventRemote({
        title: form.title,
        description: form.description || null,
        eventDate: form.event_date,
        location: form.location || null,
        category: "General",
        industry: { refId: null, name: "General" },
        registrationForm: { fields: [] },
      })
    )

    if (createEventRemote.rejected.match(result)) return
    navigate("/events")
  }

  return (
    <MainLayout
      title="Create Event"
      subtitle="Buat event baru untuk workflow EMS Anda."
    >
      <div className="mx-auto max-w-2xl">
        <form
          className="overflow-hidden rounded-[12px] border border-neutral-300 bg-white shadow-sm"
          onSubmit={handleSubmit}
        >
          {/* Header */}
          <div className="border-b border-neutral-200 px-6 py-5">
            <h2 className="text-base font-semibold text-neutral-900">
              Informasi Event
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Lengkapi data dasar event. Kolom bertanda{" "}
              <span className="font-semibold text-danger">*</span> wajib diisi.
            </p>
          </div>

          {/* Body */}
          <div className="grid gap-5 px-6 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Judul Event" required>
                <input
                  value={form.title}
                  onChange={(event) => handleChange("title", event.target.value)}
                  className={FIELD_CLASS}
                  placeholder="Contoh: Health Innovation Summit 2026"
                  required
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field
                label="Deskripsi"
                hint="Ringkasan singkat yang akan tampil di workspace dan form peserta."
              >
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) =>
                    handleChange("description", event.target.value)
                  }
                  className={TEXTAREA_CLASS}
                  placeholder="Tulis deskripsi event..."
                />
              </Field>
            </div>

            <Field label="Tanggal & Waktu" required>
              <input
                type="datetime-local"
                value={form.event_date}
                onChange={(event) =>
                  handleChange("event_date", event.target.value)
                }
                className={FIELD_CLASS}
                required
              />
            </Field>

            <Field label="Lokasi" required>
              <input
                value={form.location}
                onChange={(event) =>
                  handleChange("location", event.target.value)
                }
                className={FIELD_CLASS}
                placeholder="Contoh: Jakarta Convention Center"
                required
              />
            </Field>

            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) =>
                  handleChange("status", event.target.value as Event["status"])
                }
                className={FIELD_CLASS}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="closed">Closed</option>
              </select>
              <p className="mt-1.5 text-xs">
                {form.status === "draft" && (
                  <span className="text-warning">
                    Draft belum terlihat oleh peserta.
                  </span>
                )}
                {form.status === "published" && (
                  <span className="text-success">
                    Published — event siap dibagikan.
                  </span>
                )}
                {form.status === "closed" && (
                  <span className="text-danger">
                    Closed — pendaftaran tidak menerima peserta baru.
                  </span>
                )}
              </p>
            </Field>

            <Field label="Kapasitas Maksimum" required>
              <input
                type="number"
                min={1}
                value={form.max_capacity}
                onChange={(event) =>
                  handleChange("max_capacity", Number(event.target.value))
                }
                className={FIELD_CLASS}
                required
              />
            </Field>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex flex-wrap gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
            <Button type="submit">Simpan Event</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/events")}
            >
              Batal
            </Button>
          </div>
        </form>
      </div>
    </MainLayout>
  )
}

export default CreateEventPage
