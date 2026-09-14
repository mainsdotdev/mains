import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Input, Text, Textarea, toast } from "@/components/ui";
import { useGetAccountQuery, useUpdateAccountMutation } from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
  SettingsDivider,
} from "./settings-layout";

interface PersonalizationFormValues {
  displayName: string;
  email: string;
  company: string;
  jobTitle: string;
  website: string;
  avatarUrl: string;
  bio: string;
}

const EMPTY_FORM: PersonalizationFormValues = {
  displayName: "",
  email: "",
  company: "",
  jobTitle: "",
  website: "",
  avatarUrl: "",
  bio: "",
};

function formFromAccount(account: Partial<PersonalizationFormValues> | undefined): PersonalizationFormValues {
  if (!account) return EMPTY_FORM;
  return {
    displayName: account.displayName ?? "",
    email: account.email ?? "",
    company: account.company ?? "",
    jobTitle: account.jobTitle ?? "",
    website: account.website ?? "",
    avatarUrl: account.avatarUrl ?? "",
    bio: account.bio ?? "",
  };
}

export default function PersonalizationSettings() {
  const { data: account, isLoading: loading, error: queryError, refetch } = useGetAccountQuery();
  const [updateAccount, { isLoading: saving }] = useUpdateAccountMutation();

  const lastSavedAt = account?.updatedAt || account?.createdAt || null;

  return (
    <SettingsPageShell
      title="Personalization"
      isLoading={loading}
      loadingMessage="Loading personalization..."
      error={queryError || undefined}
      errorMessage="Unable to load personalization details"
    >
      <PersonalizationForm
        key={account?.id}
        initialValues={formFromAccount(account)}
        lastSavedAt={lastSavedAt}
        saving={saving}
        loading={loading}
        onSubmit={updateAccount}
        onRefresh={refetch}
      />
    </SettingsPageShell>
  );
}

interface PersonalizationFormProps {
  initialValues: PersonalizationFormValues;
  lastSavedAt: Date | string | null;
  saving: boolean;
  loading: boolean;
  onSubmit: (form: PersonalizationFormValues) => { unwrap: () => Promise<unknown> };
  onRefresh: () => void;
}

function PersonalizationForm({ initialValues, lastSavedAt, saving, loading, onSubmit, onRefresh }: PersonalizationFormProps) {
  const [form, setForm] = useState<PersonalizationFormValues>(() => initialValues);
  const [isDirty, setIsDirty] = useState(false);

  const handleChange =
    <T extends keyof PersonalizationFormValues>(field: T) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      setIsDirty(true);
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    try {
      await onSubmit(form).unwrap();
      setIsDirty(false);
      toast.success("Personalization updated");
    } catch (err) {
      toast.error(extractErrorMessage(err, "A problem occurred while saving"));
    }
  };

  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return null;
    const date = new Date(lastSavedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [lastSavedAt]);

  return (
        <form onSubmit={handleSubmit} className="space-y-0">
          <SettingsSection title="Profile">
            <SettingsRow
              title="Display Name"
              description="Your name displayed across the app"
            >
              <Input
                id="displayName"
                value={form.displayName}
                onChange={handleChange("displayName")}
                disabled={saving}
                placeholder="e.g. Alex Smith"
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow title="Email" description="Used for notifications">
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                disabled={saving}
                placeholder="you@example.com"
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              title="Company"
              description="Your organization or workplace"
            >
              <Input
                id="company"
                value={form.company}
                onChange={handleChange("company")}
                disabled={saving}
                placeholder="e.g. Laurel"
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow title="Job Title" description="Your role or position">
              <Input
                id="jobTitle"
                value={form.jobTitle}
                onChange={handleChange("jobTitle")}
                disabled={saving}
                placeholder="e.g. Product Lead"
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Links & Media">
            <SettingsRow
              title="Website"
              description="Your personal or company website"
            >
              <Input
                id="website"
                value={form.website}
                onChange={handleChange("website")}
                disabled={saving}
                placeholder="https://"
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              title="Avatar URL"
              description="Link to your profile picture"
            >
              <Input
                id="avatarUrl"
                value={form.avatarUrl}
                onChange={handleChange("avatarUrl")}
                disabled={saving}
                placeholder="https://cdn.example.com/me.png"
                className="min-w-80"
              />
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              title="Bio"
              description="Tell us a little about yourself"
            >
              <Textarea
                id="bio"
                className="resize-none w-80 h-16"
                value={form.bio}
                onChange={handleChange("bio")}
                disabled={saving}
                placeholder="A short description..."
              />
            </SettingsRow>
          </SettingsSection>

          <div className="flex items-center justify-between pt-2">
            <Text as="div" size="xs" tone="subtle">
              {lastSavedLabel
                ? `Last saved: ${lastSavedLabel}`
                : "Not saved yet"}
            </Text>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRefresh()}
                disabled={loading || saving}
              >
                Refresh
              </Button>
              <Button
                type="submit"
                disabled={!isDirty || saving}
                isLoading={saving}
                variant="submit"
              >
                Save
              </Button>
            </div>
          </div>
        </form>
  );
}


