import { type FormEvent, useEffect, useState } from "react";
import { profileRequest, updatePasswordRequest, updateProfileRequest } from "../auth/auth.api";
import { useAuth } from "../auth/auth.context";

export function ProfilePage() {
  const { token, user, refreshMe, logout } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapProfile() {
      if (!token) {
        return;
      }

      try {
        const profile = await profileRequest(token);
        if (isMounted) {
          setName(profile.name ?? "");
        }
      } catch {
        if (isMounted) {
          logout();
        }
      }
    }

    void bootstrapProfile();
    return () => {
      isMounted = false;
    };
  }, [logout, token]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsProfileSaving(true);

    try {
      await updateProfileRequest(token, { name });
      await refreshMe();
      setSuccess("Profile updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update profile");
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsPasswordSaving(true);

    try {
      await updatePasswordRequest(token, { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Password updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update password");
    } finally {
      setIsPasswordSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-float backdrop-blur-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Admin account</p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Profile settings</h2>
        <p className="mt-2 text-sm text-slate-600">
          Manage admin identity used across warehouse, couriers, and orders control.
        </p>

        <dl className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-1 font-semibold text-slate-900">{user?.email ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</dt>
            <dd className="mt-1 font-semibold text-slate-900">{user?.role ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification</dt>
            <dd className="mt-1 font-semibold text-slate-900">
              {user?.isEmailVerified ? "Verified" : "Pending"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-card backdrop-blur-sm"
          onSubmit={handleProfileSubmit}
        >
          <h3 className="text-lg font-bold text-slate-900">Update name</h3>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Name</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              required
            />
          </label>
          <button
            className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
            type="submit"
            disabled={isProfileSaving}
          >
            {isProfileSaving ? "Saving..." : "Save profile"}
          </button>
        </form>

        <form
          className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-card backdrop-blur-sm"
          onSubmit={handlePasswordSubmit}
        >
          <h3 className="text-lg font-bold text-slate-900">Change password</h3>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Current password</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">New password</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none ring-brand-200 transition focus:ring"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>
          <button
            className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
            type="submit"
            disabled={isPasswordSaving}
          >
            {isPasswordSaving ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}
    </section>
  );
}
