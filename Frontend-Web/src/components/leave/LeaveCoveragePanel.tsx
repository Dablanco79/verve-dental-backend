import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type { CoverageGroup, LeaveCoverageSettings } from "../../types/leaveCoverage.js";

const apiClient = createApiClient(loadConfig());

type Props = {
  clinicId: string;
};

type RosterEligibleStaff = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};

function staffName(user: RosterEligibleStaff): string {
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return fullName || user.displayName || user.email;
}

export function LeaveCoveragePanel({ clinicId }: Props) {
  const [settings, setSettings] = useState<LeaveCoverageSettings | null>(null);
  const [groups, setGroups] = useState<CoverageGroup[]>([]);
  const [staff, setStaff] = useState<RosterEligibleStaff[]>([]);
  const [draftMembers, setDraftMembers] = useState<Record<string, string[]>>({});
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSettings, nextGroups, nextStaff] = await Promise.all([
        apiClient.getLeaveCoverageSettings(clinicId),
        apiClient.listLeaveCoverageGroups(clinicId),
        apiClient.listRosterEligibleStaff(clinicId),
      ]);
      setSettings(nextSettings);
      setGroups(nextGroups);
      setStaff(nextStaff);
      setDraftMembers(Object.fromEntries(nextGroups.map((group) => [
        group.id,
        [...group.memberUserIds],
      ])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load coverage settings.");
    } finally {
      setIsLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(enabled: boolean): Promise<void> {
    setBusyKey("settings");
    setError(null);
    setNotice(null);
    try {
      setSettings(await apiClient.updateLeaveCoverageSettings(clinicId, enabled));
      setNotice(`Coverage warnings ${enabled ? "enabled" : "disabled"}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update coverage settings.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createGroup(): Promise<void> {
    const name = newName.trim();
    if (!name) return;
    setBusyKey("create");
    setError(null);
    try {
      const created = await apiClient.createLeaveCoverageGroup(clinicId, name);
      setGroups((current) => [...current, created]);
      setDraftMembers((current) => ({ ...current, [created.id]: [] }));
      setNewName("");
      setNotice("Coverage group created.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create coverage group.");
    } finally {
      setBusyKey(null);
    }
  }

  async function renameGroup(group: CoverageGroup, name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === group.name) return;
    setBusyKey(`name:${group.id}`);
    setError(null);
    try {
      const updated = await apiClient.updateLeaveCoverageGroup(clinicId, group.id, trimmedName);
      setGroups((current) => current.map((item) => item.id === group.id ? updated : item));
      setNotice("Coverage group renamed.");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename coverage group.");
    } finally {
      setBusyKey(null);
    }
  }

  function toggleMember(groupId: string, userId: string, checked: boolean): void {
    setDraftMembers((current) => {
      const members = current[groupId] ?? [];
      return {
        ...current,
        [groupId]: checked
          ? Array.from(new Set([...members, userId]))
          : members.filter((id) => id !== userId),
      };
    });
  }

  async function saveMembers(groupId: string): Promise<void> {
    setBusyKey(`members:${groupId}`);
    setError(null);
    try {
      const updated = await apiClient.replaceLeaveCoverageGroupMembers(
        clinicId,
        groupId,
        draftMembers[groupId] ?? [],
      );
      setGroups((current) => current.map((item) => item.id === groupId ? updated : item));
      setNotice("Coverage group memberships saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save group memberships.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="status-card lv-coverage-panel" aria-labelledby="leave-coverage-heading">
      <div className="status-card__header">
        <div>
          <h2 id="leave-coverage-heading">Leave coverage warnings</h2>
          <p className="inventory-page__subtitle">
            Advisory warnings for overlapping approved leave within coverage groups.
          </p>
        </div>
        {settings ? (
          <label className="lv-coverage-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busyKey !== null}
              onChange={(event) => { void toggleEnabled(event.target.checked); }}
            />
            {settings.enabled ? "Enabled" : "Disabled"}
          </label>
        ) : null}
      </div>

      {isLoading ? <p className="loading-message">Loading coverage settings…</p> : null}
      {!isLoading && settings?.enabled && groups.length === 0 ? (
        <p className="lv-coverage-warning" role="status">
          Coverage warnings are enabled but not configured. Create a coverage group and assign staff.
        </p>
      ) : null}
      {error ? <p className="status-card__error" role="alert">{error}</p> : null}
      {notice ? <p className="inventory-notice" role="status">{notice}</p> : null}

      {!isLoading ? (
        <>
          <div className="lv-coverage-create">
            <label>
              New group name
              <input
                value={newName}
                maxLength={200}
                onChange={(event) => { setNewName(event.target.value); }}
              />
            </label>
            <button
              type="button"
              disabled={!newName.trim() || busyKey !== null}
              onClick={() => { void createGroup(); }}
            >
              Create group
            </button>
          </div>

          <div className="lv-coverage-groups">
            {groups.map((group) => (
              <fieldset className="lv-coverage-group" key={group.id}>
                <legend>{group.name}</legend>
                <label className="lv-coverage-group__name">
                  Group name
                  <input
                    defaultValue={group.name}
                    disabled={busyKey !== null}
                    onBlur={(event) => { void renameGroup(group, event.target.value); }}
                  />
                </label>
                <div className="lv-coverage-members">
                  {staff.map((member) => (
                    <label key={member.id}>
                      <input
                        type="checkbox"
                        checked={(draftMembers[group.id] ?? []).includes(member.id)}
                        disabled={busyKey !== null}
                        onChange={(event) => {
                          toggleMember(group.id, member.id, event.target.checked);
                        }}
                      />
                      <span>{staffName(member)}</span>
                      <small>{member.email}</small>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => { void saveMembers(group.id); }}
                >
                  {busyKey === `members:${group.id}` ? "Saving…" : "Save memberships"}
                </button>
              </fieldset>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
