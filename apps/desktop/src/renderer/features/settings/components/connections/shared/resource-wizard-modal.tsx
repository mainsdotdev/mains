import { ReactNode, useState } from "react";

import {
  ErrorText,
  getSegmentedTabId,
  SegmentedTabs,
  WizardModal,
  useWizard,
  type WizardStep,
} from "@/components/ui";
import {
  useLazyGetSelectedResourcesQuery,
  useSaveCredentialsMutation,
  useSaveResourcesMutation,
  useDeleteResourceMutation,
  useLazyGetConnectionQuery,
} from "@/lib/redux/api";
import { RevokeConfirmModal } from "./revoke-confirm-modal";
import { ManageResourcesStep } from "./manage-resources-step";
import { SelectResourcesStep } from "./select-resources-step";
import { CredentialStep } from "./credential-step";
import { AutoSyncSection } from "./auto-sync-section";
import { useConnectionModalState } from "./use-connection-modal-state";
import { ConnectionLoadingStep } from "./connection-loading-step";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { withMinDelay } from "@/lib/with-min-delay";

const CRED_MIN_LOADING_MS = 800;
const SAVE_MIN_LOADING_MS = 1000;

export interface CredentialField {
  id: string;
  label: string;
  placeholder: string;
  /** Key in wizard data holding this field's value */
  dataKey: string;
  type?: "text" | "password" | "email";
  helperText?: string;
  required?: boolean;
  /** Custom validation error when field is empty */
  emptyError?: string;
}

export interface ResourceWizardConfig {
  provider: string;
  appName: string;
  modalTitle: string;
  icon: string;

  credentialDescription: string;
  credentialInstructions: ReactNode;
  credentialFields: CredentialField[];
  /** Build SaveCredentials payload extras (provider, connectionId added by wrapper) */
  buildCredentials: (values: Record<string, string>) => Record<string, string>;
  /**
   * Optional second sign-in method rendered as a tab on the credential step
   * (e.g. GitHub's OAuth device flow). `submitValues` runs the same
   * save-credentials → fetch-resources tail the token form uses, so both
   * methods land on the resource-select step identically.
   */
  credentialAlternative?: {
    /** Tab label for the alternative method (e.g. "Sign in with GitHub"). */
    label: string;
    /** Tab label for the manual token form (e.g. "Access token"). */
    tokenLabel: string;
    render: (ctx: {
      submitValues: (values: Record<string, string>) => Promise<void>;
      submitting: boolean;
    }) => ReactNode;
  };

  loadingMessage: string;
  selectTitle: string;
  resourceLabel: string;
  resourceLabelPlural: string;
  saveButtonLabel?: (count: number) => string;
  addButtonLabel?: string;
  revokeButtonLabel?: string;
  revokeDescription: string;

  /** Identity for items from "all available" list (used as React key + selection key) */
  identityForItem: (item: any) => string;
  /** Identity for items from "currently connected" list (used to filter dupes) */
  identityForCurrent: (current: any) => string;
  /**
   * Text the select step's search box matches a query against. Return
   * everything the row shows (identity plus any secondary label) — an account
   * with hundreds of repos is otherwise a scroll.
   */
  searchTextForItem: (item: any) => string;

  renderItemForSelect: (item: any) => ReactNode;
  renderItemForManage: (resource: any) => ReactNode;

  /** When set, renders <AutoSyncSection> under the manage list */
  autoSyncProviderLabel?: string;
}

interface WizardData {
  connectionId: string;
  items: any[];
  selectedIds: Set<string>;
  current: any[];
  isFirstConnection: boolean;
  fromManage: boolean;
  /** Last validation/submit error (single field, single message) */
  errorMessage: string;
  [credKey: string]: any;
}

interface ResourceWizardModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
  config: ResourceWizardConfig;
  /** Provider-specific "fetch all" trigger; caller invokes the lazy hook. */
  fetchAllResources: (
    connectionId: string,
  ) => Promise<any[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials step
// ─────────────────────────────────────────────────────────────────────────────

function CredentialsStep({
  config,
  fetchAllResources,
  onSuccess,
}: {
  config: ResourceWizardConfig;
  fetchAllResources: (
    connectionId: string,
  ) => Promise<any[]>;
  onSuccess?: () => void;
}) {
  const { data, setData, goTo } = useWizard<WizardData>();
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<"alternative" | "token">(
    config.credentialAlternative ? "alternative" : "token",
  );
  const [getConnection] = useLazyGetConnectionQuery();
  const [saveCredentials] = useSaveCredentialsMutation();

  // Shared submit tail — both the token form and any alternative sign-in
  // method (device flow) land here with the same credential values shape.
  const submitValues = async (formValues: Record<string, string>) => {
    setLoading(true);
    setData({ errorMessage: "" });

    try {
      const work = (async () => {
        const connection = await getConnection(config.provider).unwrap();
        const connId = connection.id;

        await saveCredentials({
          provider: config.provider,
          connectionId: connId,
          ...config.buildCredentials(formValues),
        }).unwrap();

        onSuccess?.();

        const items = await fetchAllResources(connId);
        return { connId, items };
      })();

      const { connId, items } = await withMinDelay(work, CRED_MIN_LOADING_MS);

      setData({
        connectionId: connId,
        items,
        isFirstConnection: true,
        fromManage: false,
      });
      goTo("add");
    } catch (err) {
      console.error(`[${config.provider}] credentials submit:`, err);
      setData({
        errorMessage: extractErrorMessage(
          err,
          `Failed to connect to ${config.appName}.`,
        ),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    for (const field of config.credentialFields) {
      const value = (data[field.dataKey] as string | undefined) ?? "";
      if (field.required === false) continue;
      if (!value.trim()) {
        setData({
          errorMessage:
            field.emptyError ?? `Please enter a valid ${field.label}`,
        });
        return;
      }
    }

    const formValues: Record<string, string> = {};
    for (const field of config.credentialFields) {
      formValues[field.dataKey] =
        (data[field.dataKey] as string | undefined) ?? "";
    }
    await submitValues(formValues);
  };

  const tokenForm = (
    <CredentialStep
      description={config.credentialDescription}
      fields={config.credentialFields.map((field) => ({
        id: field.id,
        label: field.label,
        placeholder: field.placeholder,
        type: field.type,
        helperText: field.helperText,
        required: field.required,
        value: (data[field.dataKey] as string | undefined) ?? "",
        onChange: (value) => {
          setData({ [field.dataKey]: value, errorMessage: "" } as Partial<WizardData>);
        },
      }))}
      instructions={config.credentialInstructions}
      onSubmit={handleSubmit}
      loading={loading}
      error={data.errorMessage || ""}
    />
  );

  const alternative = config.credentialAlternative;
  if (!alternative) return tokenForm;

  return (
    <div className="space-y-4">
      <SegmentedTabs
        id="connection-auth-method-tabs"
        value={method}
        onChange={(next) => {
          setMethod(next);
          setData({ errorMessage: "" });
        }}
        options={[
          { value: "alternative", label: alternative.label },
          { value: "token", label: alternative.tokenLabel },
        ]}
        panelId="connection-auth-method-panel"
        aria-label="Authentication method"
        className="w-fit"
      />
      {/* Both panes stay mounted in the same grid cell so the modal keeps
          one height across tabs (the taller pane sets it) and each tab's
          state survives switching. */}
      <div
        id="connection-auth-method-panel"
        role="tabpanel"
        aria-labelledby={getSegmentedTabId(
          "connection-auth-method-tabs",
          method,
        )}
        className="grid"
      >
        <div
          className={`col-start-1 row-start-1 ${
            method === "token" ? "" : "invisible pointer-events-none"
          }`}
          aria-hidden={method !== "token"}
        >
          {tokenForm}
        </div>
        <div
          className={`col-start-1 row-start-1 flex flex-col ${
            method === "token" ? "invisible pointer-events-none" : ""
          }`}
          aria-hidden={method === "token"}
        >
          {alternative.render({ submitValues, submitting: loading })}
          {data.errorMessage ? <ErrorText>{data.errorMessage}</ErrorText> : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Select step
// ─────────────────────────────────────────────────────────────────────────────

function SelectStep({
  config,
  onComplete,
}: {
  config: ResourceWizardConfig;
  onComplete: () => void;
}) {
  const { data, setData, goTo } = useWizard<WizardData>();
  const [loading, setLoading] = useState(false);
  const [saveResources] = useSaveResourcesMutation();
  const [getSelected] = useLazyGetSelectedResourcesQuery();

  const selectedIds = data.selectedIds || new Set<string>();

  const toggle = (id: string | number) => {
    const key = String(id);
    const next = new Set(selectedIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setData({ selectedIds: next });
  };

  const handleSave = async () => {
    if (selectedIds.size === 0) {
      setData({
        errorMessage: `Please select at least one ${config.resourceLabel}`,
      });
      return;
    }

    setLoading(true);
    setData({ errorMessage: "" });

    try {
      const work = (async () => {
        const selectedItems = data.items.filter((item) =>
          selectedIds.has(config.identityForItem(item)),
        );
        await saveResources({
          provider: config.provider,
          connectionId: data.connectionId,
          resources: selectedItems,
        }).unwrap();

        if (data.fromManage) {
          const result = await getSelected(config.provider).unwrap();
          return result.items;
        }
        return null;
      })();

      const refetched = await withMinDelay(work, SAVE_MIN_LOADING_MS);

      if (data.fromManage) {
        if (refetched) {
          setData({ current: refetched, selectedIds: new Set() });
        }
        goTo("manage");
      } else {
        onComplete();
      }
    } catch (err) {
      setData({ errorMessage: extractErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (data.fromManage) goTo("manage");
    else if (data.isFirstConnection) onComplete();
    else goTo("setToken");
  };

  const saveLabel =
    config.saveButtonLabel?.(selectedIds.size) ??
    `Save ${selectedIds.size} ${selectedIds.size === 1 ? config.resourceLabel : config.resourceLabelPlural}`;

  return (
    <SelectResourcesStep
      resources={data.items.map((item) => ({
        ...item,
        id: config.identityForItem(item),
      }))}
      selectedResources={selectedIds}
      onToggleResource={toggle}
      onSave={handleSave}
      onBack={handleBack}
      loading={loading}
      error={data.errorMessage || ""}
      title={config.selectTitle}
      saveButtonLabel={saveLabel}
      renderResourceItem={(item) => config.renderItemForSelect(item)}
      searchTextForResource={config.searchTextForItem}
      searchPlaceholder={`Search ${config.resourceLabelPlural}`}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage step
// ─────────────────────────────────────────────────────────────────────────────

function ManageStep({
  config,
  fetchAllResources,
  onRevoke,
}: {
  config: ResourceWizardConfig;
  fetchAllResources: (
    connectionId: string,
  ) => Promise<any[]>;
  onRevoke: () => void;
}) {
  const { data, setData, goTo } = useWizard<WizardData>();
  const [loading, setLoading] = useState(false);
  const [deleteResource] = useDeleteResourceMutation();
  const [getSelected] = useLazyGetSelectedResourcesQuery();

  const handleRemove = async (resourceId: string) => {
    setData({ errorMessage: "" });
    try {
      await deleteResource(resourceId).unwrap();
      const result = await getSelected(config.provider).unwrap();
      setData({ current: result.items });
    } catch (err) {
      setData({ errorMessage: extractErrorMessage(err) });
    }
  };

  const handleAddNew = async () => {
    setLoading(true);
    setData({ errorMessage: "" });
    try {
      const items = await fetchAllResources(data.connectionId);
      const currentIds = new Set(data.current.map(config.identityForCurrent));
      const available = items.filter(
        (item) => !currentIds.has(config.identityForItem(item)),
      );
      if (available.length === 0) {
        setData({
          errorMessage: `All ${config.resourceLabelPlural} are already connected`,
        });
        return;
      }
      setData({
        items: available,
        selectedIds: new Set(),
        fromManage: true,
      });
      goTo("add");
    } catch (err) {
      setData({ errorMessage: extractErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  // ManageResourcesStep needs `name` on each item; re-shape current data so its
  // default render path works when no custom renderer is given.
  const reshaped = data.current.map((c) => ({ ...c, fullName: c.fullName ?? c.name }));

  return (
    <ManageResourcesStep
      resources={reshaped}
      onAddNew={handleAddNew}
      onRemove={handleRemove}
      onRevoke={onRevoke}
      loading={loading}
      error={data.errorMessage || ""}
      resourceLabel={config.resourceLabel}
      resourceLabelPlural={config.resourceLabelPlural}
      addButtonLabel={config.addButtonLabel ?? `Add ${capitalize(config.resourceLabel)}`}
      revokeButtonLabel={config.revokeButtonLabel ?? `Revoke ${config.appName} Access`}
      renderResourceItem={(resource) => config.renderItemForManage(resource)}
      extraContent={
        config.autoSyncProviderLabel ? (
          <AutoSyncSection
            provider={config.provider}
            providerLabel={config.autoSyncProviderLabel}
          />
        ) : undefined
      }
    />
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

export function ResourceWizardModal({
  open,
  onClose,
  isConnected,
  onSuccess,
  config,
  fetchAllResources,
}: ResourceWizardModalProps) {
  const [getSelected] = useLazyGetSelectedResourcesQuery();

  const baseData: Partial<WizardData> = {
    connectionId: "",
    items: [],
    selectedIds: new Set<string>(),
    current: [],
    isFirstConnection: false,
    fromManage: false,
    errorMessage: "",
  };
  for (const field of config.credentialFields) {
    baseData[field.dataKey] = "";
  }

  const {
    initState,
    showRevokeConfirm,
    setShowRevokeConfirm,
    handleClose,
    handleRevoke,
    isRevoking,
  } = useConnectionModalState<WizardData>({
    open,
    onClose,
    isConnected,
    provider: config.provider,
    appName: config.appName,
    baseData,
    fetchSelected: async () => {
      const result = await getSelected(config.provider).unwrap();
      return {
        connectionId: result.connectionId,
        current: result.items,
      };
    },
  });

  const steps: WizardStep<WizardData>[] = [
    {
      id: "loading",
      render: () => (
        <ConnectionLoadingStep
          targetStep={initState.targetStep}
          message={config.loadingMessage}
        />
      ),
    },
    {
      id: "setToken",
      render: () => (
        <CredentialsStep
          config={config}
          fetchAllResources={fetchAllResources}
          onSuccess={onSuccess}
        />
      ),
    },
    {
      id: "add",
      render: () => <SelectStep config={config} onComplete={handleClose} />,
    },
    {
      id: "manage",
      render: () => (
        <ManageStep
          config={config}
          fetchAllResources={fetchAllResources}
          onRevoke={() => setShowRevokeConfirm(true)}
        />
      ),
    },
  ];

  return (
    <>
      <WizardModal
        open={open}
        onOpenChange={(isOpen) => !isOpen && handleClose()}
        steps={steps}
        initialStep="loading"
        initialData={initState.data}
        title={config.modalTitle}
        icon={config.icon}
        onCancel={handleClose}
      />

      {showRevokeConfirm && (
        <RevokeConfirmModal
          onConfirm={handleRevoke}
          onCancel={() => setShowRevokeConfirm(false)}
          loading={isRevoking}
          appName={config.appName}
          description={config.revokeDescription}
        />
      )}
    </>
  );
}
