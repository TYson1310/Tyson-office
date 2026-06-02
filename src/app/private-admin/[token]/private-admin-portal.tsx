"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  LoaderCircle,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Store,
  Trash2,
  Ticket,
  Upload,
  UserCog,
  X,
} from "lucide-react";
import { SectionCard } from "@/components/erp/section-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { BRAND } from "@/lib/brand";
import { COMMON_TIME_ZONES, formatDateTime } from "@/lib/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import { StatCard } from "@/components/erp/stat-card";

type AdminStatus = "active" | "inactive" | "on-leave";

type AdminAccount = {
  id: string;
  email: string;
  fullName: string;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
  permissions: string[];
};

type StoreStatus = "active" | "inactive";

type StoreRecord = {
  storeKey: string;
  name: string;
  status: StoreStatus;
  timeZone: string;
  openingFloat: number;
  closingFloat: number;
  scratchBinCount: number;
  lotteryRetailerCommissionRate: number;
  lotteryCashingBonusRate: number;
  createdAt: string;
  updatedAt: string;
};

type StoreDeleteResponse = {
  authDeleteFailures?: Array<{ email: string | null; id: string }>;
  deletedAuthUsers: number;
  deletedTables: number;
  success: true;
};

type CredentialNotice = {
  email: string;
  temporaryPassword: string;
};

type AdminFormState = {
  fullName: string;
  email: string;
  status: AdminStatus;
  password: string;
};

type StoreFormState = {
  storeKey: string;
  name: string;
  status: StoreStatus;
  timeZone: string;
  openingFloat: string;
  closingFloat: string;
  scratchBinCount: string;
  lotteryRetailerCommissionRate: string;
  lotteryCashingBonusRate: string;
};

type ImportedGameCatalogGame = {
  id: string;
  gameId: string;
  gameName: string;
  ticketPrice: number;
  ticketCount: number | null;
  packValue: number | null;
  isActive: boolean;
  imageUrl: string;
  sourcePage: number | null;
  cropIndex: number | null;
  importedAt: string;
};

type GameCatalogPriceSetting = {
  activeGameCount: number;
  configuredGameCount: number;
  gameCount: number;
  hasMixedTicketCounts: boolean;
  packValue: number | null;
  ticketCount: number | null;
  ticketPrice: number;
};

type GameCatalogExtractionSummary = {
  imageCount: number | null;
  matchedCount: number | null;
  recordCount: number | null;
};

type GameCatalogPreviewPrize = {
  prizeAmount: string;
  prizeRank: number;
  remainingCount: number;
  sourceText: string | null;
};

type GameCatalogPreviewGame = {
  cropIndex: number;
  existingGame: {
    gameName: string;
    isActive: boolean;
    ticketPrice: number;
  } | null;
  gameId: string;
  gameName: string;
  imageDataUrl: string;
  prizeCount: number;
  prizes: GameCatalogPreviewPrize[];
  sourcePage: number;
  ticketPrice: number;
};

type GameCatalogImportPreview = {
  existingCount: number;
  extraction?: GameCatalogExtractionSummary;
  games: GameCatalogPreviewGame[];
  newCount: number;
  prizeCount: number;
  warnings?: string[];
};

type GameLedgerEditState = {
  gameName: string;
  isActive: "active" | "inactive";
  ticketCount: string;
  ticketPrice: string;
};

type PortalView = "admins" | "catalog" | "stores";

const EMPTY_FORM: AdminFormState = {
  fullName: "",
  email: "",
  status: "active",
  password: "",
};

const EMPTY_STORE_FORM: StoreFormState = {
  storeKey: "",
  name: "",
  status: "active",
  timeZone: BRAND.defaultBusinessProfile.timezone,
  openingFloat: "",
  closingFloat: "",
  scratchBinCount: "40",
  lotteryRetailerCommissionRate: "0",
  lotteryCashingBonusRate: "0",
};

const COMPACT_CARD_CLASS = "rounded-xl bg-white shadow-sm sm:rounded-xl";
const COMPACT_HEADER_CLASS =
  "gap-2 px-3 py-3 sm:px-4 [&_h2]:!text-sm [&_p]:!text-xs";
const COMPACT_CONTENT_CLASS = "p-3 sm:p-4";
const COMPACT_STACK_CONTENT_CLASS = "space-y-3 p-3 sm:p-4";
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function getPriceSettingKey(ticketPrice: number) {
  return ticketPrice.toFixed(2);
}

function buildTicketCountDrafts(settings: GameCatalogPriceSetting[]) {
  return Object.fromEntries(
    settings.map((setting) => [
      getPriceSettingKey(setting.ticketPrice),
      setting.ticketCount?.toString() ?? "",
    ]),
  );
}

function getStatusTone(status: AdminStatus) {
  if (status === "inactive") {
    return "red" as const;
  }

  if (status === "on-leave") {
    return "amber" as const;
  }

  return "green" as const;
}

function getStoreStatusTone(status: StoreStatus) {
  return status === "inactive" ? ("red" as const) : ("green" as const);
}

function formatTimestamp(
  value: string,
  timeZone: string = BRAND.defaultBusinessProfile.timezone,
) {
  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? "Request failed");
  }

  return payload;
}

export function PrivateAdminPortal({
  routeToken,
  isAuthorized,
}: {
  routeToken: string;
  isAuthorized: boolean;
}) {
  const { notify } = useAppNotifications();
  const [isUnlocked, setIsUnlocked] = useState(isAuthorized);
  const [masterPassword, setMasterPassword] = useState("");
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(isAuthorized);
  const [isLoadingStores, setIsLoadingStores] = useState(isAuthorized);
  const [isLoadingGameCatalogSettings, setIsLoadingGameCatalogSettings] =
    useState(isAuthorized);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSavingAdmin, setIsSavingAdmin] = useState(false);
  const [isSavingStore, setIsSavingStore] = useState(false);
  const [deletingStoreKey, setDeletingStoreKey] = useState<string | null>(null);
  const [isImportingGameCatalog, setIsImportingGameCatalog] = useState(false);
  const [savingTicketCountPrice, setSavingTicketCountPrice] = useState<
    string | null
  >(null);
  const [isAdminFormOpen, setIsAdminFormOpen] = useState(false);
  const [isStoreFormOpen, setIsStoreFormOpen] = useState(false);
  const [isGameCatalogFormOpen, setIsGameCatalogFormOpen] = useState(false);
  const [isPackSettingsMinimized, setIsPackSettingsMinimized] = useState(true);
  const [isGamesLedgerMinimized, setIsGamesLedgerMinimized] = useState(true);
  const [activeView, setActiveView] = useState<PortalView>("admins");
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editingStoreKey, setEditingStoreKey] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [savingGameId, setSavingGameId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AdminFormState>(EMPTY_FORM);
  const [storeFormState, setStoreFormState] =
    useState<StoreFormState>(EMPTY_STORE_FORM);
  const [gameLedgerEditState, setGameLedgerEditState] =
    useState<GameLedgerEditState | null>(null);
  const [gameCatalogFile, setGameCatalogFile] = useState<File | null>(null);
  const [gameCatalogImportPreview, setGameCatalogImportPreview] =
    useState<GameCatalogImportPreview | null>(null);
  const [gameCatalogGames, setGameCatalogGames] = useState<
    ImportedGameCatalogGame[]
  >([]);
  const [gameCatalogPriceSettings, setGameCatalogPriceSettings] = useState<
    GameCatalogPriceSetting[]
  >([]);
  const [gameCatalogImportWarnings, setGameCatalogImportWarnings] = useState<
    string[]
  >([]);
  const [isSavingGameCatalogImport, setIsSavingGameCatalogImport] =
    useState(false);
  const [ticketCountDrafts, setTicketCountDrafts] = useState<
    Record<string, string>
  >({});
  const [credentialNotice, setCredentialNotice] =
    useState<CredentialNotice | null>(null);

  const showNotice = useCallback(
    (type: "success" | "error", message: string) => {
      notify({ type, message });
    },
    [notify],
  );

  const resetForm = useCallback(() => {
    setEditingAdminId(null);
    setFormState(EMPTY_FORM);
    setIsAdminFormOpen(false);
  }, []);

  const resetStoreForm = useCallback(() => {
    setEditingStoreKey(null);
    setStoreFormState(EMPTY_STORE_FORM);
    setIsStoreFormOpen(false);
  }, []);

  const openNewAdminForm = useCallback(() => {
    setEditingAdminId(null);
    setCredentialNotice(null);
    setFormState(EMPTY_FORM);
    setIsAdminFormOpen(true);
  }, []);

  const openNewStoreForm = useCallback(() => {
    setEditingStoreKey(null);
    setStoreFormState(EMPTY_STORE_FORM);
    setIsStoreFormOpen(true);
  }, []);

  const resetUnlockedState = useCallback(() => {
    setIsUnlocked(false);
    setAdmins([]);
    setStores([]);
    setCredentialNotice(null);
    setGameCatalogFile(null);
    setGameCatalogImportPreview(null);
    setGameCatalogGames([]);
    setGameCatalogPriceSettings([]);
    setGameCatalogImportWarnings([]);
    setTicketCountDrafts({});
    setEditingGameId(null);
    setSavingGameId(null);
    setGameLedgerEditState(null);
    setIsLoadingGameCatalogSettings(false);
    setIsSavingGameCatalogImport(false);
    setSavingTicketCountPrice(null);
    setIsGameCatalogFormOpen(false);
    resetForm();
    resetStoreForm();
  }, [resetForm, resetStoreForm]);

  const handleSessionExpired = useCallback(() => {
    resetUnlockedState();
    showNotice(
      "error",
      "Master password session expired. Unlock the page again.",
    );
  }, [resetUnlockedState, showNotice]);

  const buildGameCatalogUploadFormData = (intent: "commit" | "preview") => {
    if (!gameCatalogFile) {
      showNotice("error", "Choose a game catalog PDF first.");
      return null;
    }

    const formData = new FormData();
    formData.append("file", gameCatalogFile);
    formData.append("intent", intent);

    return formData;
  };

  const handlePreviewGameCatalog = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const formData = buildGameCatalogUploadFormData("preview");

    if (!formData) {
      return;
    }

    setIsImportingGameCatalog(true);
    setGameCatalogImportWarnings([]);
    setGameCatalogImportPreview(null);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/game-catalog`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<{
        extraction?: GameCatalogExtractionSummary;
        existingCount: number;
        games: GameCatalogPreviewGame[];
        newCount: number;
        prizeCount: number;
        warnings?: string[];
      }>(response);
      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.map((warning) => warning.trim()).filter(Boolean)
        : [];

      setGameCatalogImportPreview({ ...payload, warnings });
      setGameCatalogImportWarnings(warnings);
      showNotice(
        "success",
        [
          `Review ${payload.games.length} extracted games before saving.`,
          `${payload.prizeCount} prize rows found.`,
          warnings[0] ? `Warning: ${warnings[0]}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to preview game catalog",
      );
    } finally {
      setIsImportingGameCatalog(false);
    }
  };

  const handleConfirmGameCatalogImport = async () => {
    if (!gameCatalogImportPreview) {
      showNotice("error", "Preview the game catalog before saving.");
      return;
    }

    const formData = buildGameCatalogUploadFormData("commit");

    if (!formData) {
      return;
    }

    setIsSavingGameCatalogImport(true);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/game-catalog`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<{
        count: number;
        extraction?: GameCatalogExtractionSummary;
        inactiveCount: number;
        prizeCount: number;
        games: ImportedGameCatalogGame[];
        priceSettings: GameCatalogPriceSetting[];
        warnings?: string[];
      }>(response);
      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.map((warning) => warning.trim()).filter(Boolean)
        : [];

      setGameCatalogGames(payload.games);
      setGameCatalogPriceSettings(payload.priceSettings);
      setGameCatalogImportWarnings(warnings);
      setTicketCountDrafts(buildTicketCountDrafts(payload.priceSettings));
      setGameCatalogImportPreview(null);
      setGameCatalogFile(null);
      setIsGameCatalogFormOpen(false);
      showNotice(
        "success",
        [
          `Stored ${payload.count} active games.`,
          `Stored ${payload.prizeCount} prize rows.`,
          `Marked ${payload.inactiveCount} old games inactive.`,
          warnings[0] ? `Warning: ${warnings[0]}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to save game catalog",
      );
    } finally {
      setIsSavingGameCatalogImport(false);
    }
  };

  const loadAdmins = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    setIsLoadingAdmins(true);

    try {
      const response = await fetch(`/api/private-admin/${routeToken}/admins`, {
        cache: "no-store",
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<AdminAccount[]>(response);
      setAdmins(payload);
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to load admins",
      );
    } finally {
      setIsLoadingAdmins(false);
    }
  }, [handleSessionExpired, isUnlocked, routeToken, showNotice]);

  const loadStores = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    setIsLoadingStores(true);

    try {
      const response = await fetch(`/api/private-admin/${routeToken}/stores`, {
        cache: "no-store",
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<StoreRecord[]>(response);
      setStores(payload);
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to load stores",
      );
    } finally {
      setIsLoadingStores(false);
    }
  }, [handleSessionExpired, isUnlocked, routeToken, showNotice]);

  const loadGameCatalogSettings = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    setIsLoadingGameCatalogSettings(true);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/game-catalog`,
        {
          cache: "no-store",
        },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<{
        games: ImportedGameCatalogGame[];
        priceSettings: GameCatalogPriceSetting[];
      }>(response);

      setGameCatalogGames(payload.games);
      setGameCatalogPriceSettings(payload.priceSettings);
      setGameCatalogImportWarnings([]);
      setTicketCountDrafts(buildTicketCountDrafts(payload.priceSettings));
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to load game catalog settings",
      );
    } finally {
      setIsLoadingGameCatalogSettings(false);
    }
  }, [handleSessionExpired, isUnlocked, routeToken, showNotice]);

  const refreshPortalData = useCallback(async () => {
    if (!isUnlocked) {
      return;
    }

    await Promise.all([loadAdmins(), loadStores(), loadGameCatalogSettings()]);
  }, [isUnlocked, loadAdmins, loadGameCatalogSettings, loadStores]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    void refreshPortalData();
  }, [isUnlocked, refreshPortalData]);

  const handleSaveTicketCount = async (setting: GameCatalogPriceSetting) => {
    const priceKey = getPriceSettingKey(setting.ticketPrice);
    const draftValue = ticketCountDrafts[priceKey]?.trim() ?? "";
    const ticketCount = Number(draftValue);

    if (
      !Number.isInteger(ticketCount) ||
      ticketCount < 1 ||
      ticketCount > 1000
    ) {
      showNotice("error", "Tickets per pack must be between 1 and 1000.");
      return;
    }

    setSavingTicketCountPrice(priceKey);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/game-catalog`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ticketCount,
            ticketPrice: setting.ticketPrice,
          }),
        },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<{
        games: ImportedGameCatalogGame[];
        priceSettings: GameCatalogPriceSetting[];
      }>(response);

      setGameCatalogGames(payload.games);
      setGameCatalogPriceSettings(payload.priceSettings);
      setTicketCountDrafts(buildTicketCountDrafts(payload.priceSettings));
      showNotice(
        "success",
        `${formatCurrency(setting.ticketPrice)} packs now use ${ticketCount} tickets.`,
      );
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to save tickets per pack",
      );
    } finally {
      setSavingTicketCountPrice(null);
    }
  };

  const handleTicketCountDraftChange = (
    setting: GameCatalogPriceSetting,
    value: string,
  ) => {
    const priceKey = getPriceSettingKey(setting.ticketPrice);

    setTicketCountDrafts((current) => ({
      ...current,
      [priceKey]: value,
    }));
  };

  const handleEditGame = (game: ImportedGameCatalogGame) => {
    setEditingGameId(game.gameId);
    setGameLedgerEditState({
      gameName: game.gameName,
      isActive: game.isActive ? "active" : "inactive",
      ticketCount: game.ticketCount?.toString() ?? "",
      ticketPrice: game.ticketPrice.toString(),
    });
  };

  const handleCancelGameEdit = () => {
    setEditingGameId(null);
    setGameLedgerEditState(null);
  };

  const handleSaveGame = async (game: ImportedGameCatalogGame) => {
    if (!gameLedgerEditState) {
      return;
    }

    const gameName = gameLedgerEditState.gameName.trim();
    const ticketPrice = Number(gameLedgerEditState.ticketPrice);
    const ticketCountDraft = gameLedgerEditState.ticketCount.trim();
    const ticketCount =
      ticketCountDraft.length > 0 ? Number(ticketCountDraft) : null;

    if (!gameName) {
      showNotice("error", "Game name is required.");
      return;
    }

    if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) {
      showNotice("error", "Ticket price must be greater than zero.");
      return;
    }

    if (
      ticketCount !== null &&
      (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 1000)
    ) {
      showNotice("error", "Tickets per pack must be between 1 and 1000.");
      return;
    }

    setSavingGameId(game.gameId);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/game-catalog`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gameId: game.gameId,
            gameName,
            isActive: gameLedgerEditState.isActive === "active",
            ticketCount,
            ticketPrice,
          }),
        },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const payload = await parseResponse<{
        games: ImportedGameCatalogGame[];
        priceSettings: GameCatalogPriceSetting[];
      }>(response);

      setGameCatalogGames(payload.games);
      setGameCatalogPriceSettings(payload.priceSettings);
      setTicketCountDrafts(buildTicketCountDrafts(payload.priceSettings));
      handleCancelGameEdit();
      showNotice("success", `Game #${game.gameId} updated.`);
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to update game",
      );
    } finally {
      setSavingGameId(null);
    }
  };

  const submitUnlock = async () => {
    if (isSubmittingPassword) {
      return;
    }

    setIsSubmittingPassword(true);
    setCredentialNotice(null);

    try {
      const response = await fetch(`/api/private-admin/${routeToken}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ masterPassword }),
      });

      await parseResponse<{ success: true }>(response);
      setMasterPassword("");
      setIsUnlocked(true);
      showNotice("success", "Private admin portal unlocked.");
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to verify master password",
      );
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleUnlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitUnlock();
  };

  const handleLogout = async () => {
    try {
      await fetch(`/api/private-admin/${routeToken}/session`, {
        method: "DELETE",
      });
    } finally {
      resetUnlockedState();
      showNotice("success", "Private admin portal locked.");
    }
  };

  const handleEditAdmin = (admin: AdminAccount) => {
    setEditingAdminId(admin.id);
    setIsAdminFormOpen(true);
    setCredentialNotice(null);
    setFormState({
      fullName: admin.fullName,
      email: admin.email,
      status: admin.status,
      password: "",
    });
  };

  const handleSaveAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingAdmin(true);
    setCredentialNotice(null);

    const method = editingAdminId ? "PATCH" : "POST";
    const payload = editingAdminId
      ? { id: editingAdminId, ...formState }
      : formState;

    try {
      const response = await fetch(`/api/private-admin/${routeToken}/admins`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const result = await parseResponse<{
        admin?: AdminAccount;
        temporaryPassword?: string | null;
      }>(response);

      if (editingAdminId) {
        showNotice("success", "Admin account updated.");
      } else {
        showNotice("success", "Admin account created.");
      }

      if (result.temporaryPassword) {
        setCredentialNotice({
          email: formState.email,
          temporaryPassword: result.temporaryPassword,
        });
      }

      resetForm();
      await loadAdmins();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to save admin",
      );
    } finally {
      setIsSavingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (admin: AdminAccount) => {
    const confirmed = window.confirm(
      `Delete admin account for ${admin.email}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/admins?id=${encodeURIComponent(admin.id)}`,
        { method: "DELETE" },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      await parseResponse<{ success: true }>(response);
      showNotice("success", "Admin account deleted.");

      if (editingAdminId === admin.id) {
        resetForm();
      }

      await loadAdmins();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to delete admin",
      );
    }
  };

  const handleEditStore = (store: StoreRecord) => {
    setEditingStoreKey(store.storeKey);
    setIsStoreFormOpen(true);
    setStoreFormState({
      storeKey: store.storeKey,
      name: store.name,
      status: store.status,
      timeZone: store.timeZone,
      openingFloat: store.openingFloat.toString(),
      closingFloat: store.closingFloat.toString(),
      scratchBinCount: store.scratchBinCount.toString(),
      lotteryRetailerCommissionRate:
        store.lotteryRetailerCommissionRate.toString(),
      lotteryCashingBonusRate: store.lotteryCashingBonusRate.toString(),
    });
  };

  const handleSaveStore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingStore(true);

    const method = editingStoreKey ? "PATCH" : "POST";
    const payload = {
      ...storeFormState,
      ...(editingStoreKey ? { storeKey: editingStoreKey } : {}),
    };

    try {
      const response = await fetch(`/api/private-admin/${routeToken}/stores`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      await parseResponse<{ store: StoreRecord }>(response);
      showNotice(
        "success",
        editingStoreKey ? "Store updated." : "Store created.",
      );
      resetStoreForm();
      await loadStores();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to save store",
      );
    } finally {
      setIsSavingStore(false);
    }
  };

  const handleDeleteStore = async (store: StoreRecord) => {
    if (store.storeKey === "default") {
      showNotice("error", "Default store cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${store.name}? This permanently deletes database records for store key "${store.storeKey}", including staff, sales, payroll, expenses, vendors, inventory, lottery, and cash vault data.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingStoreKey(store.storeKey);

    try {
      const response = await fetch(
        `/api/private-admin/${routeToken}/stores?storeKey=${encodeURIComponent(store.storeKey)}`,
        { method: "DELETE" },
      );

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const result = await parseResponse<StoreDeleteResponse>(response);
      const failedAuthDeletions = result.authDeleteFailures?.length ?? 0;

      showNotice(
        failedAuthDeletions > 0 ? "error" : "success",
        failedAuthDeletions > 0
          ? `Store deleted, but ${failedAuthDeletions} login account(s) could not be removed.`
          : `Store deleted. Removed ${result.deletedAuthUsers} login account(s).`,
      );

      if (editingStoreKey === store.storeKey) {
        resetStoreForm();
      }

      await loadStores();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error ? error.message : "Failed to delete store",
      );
    } finally {
      setDeletingStoreKey(null);
    }
  };

  const activeAdminCount = admins.filter(
    (admin) => admin.status === "active",
  ).length;
  const activeStoreCount = stores.filter(
    (store) => store.status === "active",
  ).length;
  const activeGameCount = gameCatalogGames.filter(
    (game) => game.isActive,
  ).length;
  const inactiveGameCount = Math.max(
    gameCatalogGames.length - activeGameCount,
    0,
  );
  const configuredPackSettingCount = gameCatalogPriceSettings.filter(
    (setting) => Boolean(setting.ticketCount),
  ).length;
  const mixedPackSettingCount = gameCatalogPriceSettings.filter(
    (setting) => setting.hasMixedTicketCounts,
  ).length;
  const isRefreshingPortalData =
    isLoadingAdmins || isLoadingStores || isLoadingGameCatalogSettings;
  const portalStats = [
    {
      label: "Admins",
      value: admins.length,
      detail: `${activeAdminCount} active`,
      icon: UserCog,
      tone: "red" as const,
    },
    {
      label: "Stores",
      value: stores.length,
      detail: `${activeStoreCount} active`,
      icon: Store,
      tone: "slate" as const,
    },
    {
      label: "Catalog",
      value: gameCatalogGames.length,
      detail: `${activeGameCount} active`,
      icon: Ticket,
      tone: "violet" as const,
    },
    {
      label: "Inactive games",
      value: inactiveGameCount,
      detail: "ledger review",
      icon: AlertTriangle,
      tone: inactiveGameCount > 0 ? ("amber" as const) : ("green" as const),
    },
  ];
  const portalViews: Array<{
    description: string;
    icon: typeof UserCog;
    id: PortalView;
    label: string;
    value: number;
  }> = [
    {
      description: "People and access",
      icon: UserCog,
      id: "admins",
      label: "Admins",
      value: admins.length,
    },
    {
      description: "Games and pack settings",
      icon: Ticket,
      id: "catalog",
      label: "Game Catalog",
      value: gameCatalogGames.length,
    },
    {
      description: "Store workspaces",
      icon: Store,
      id: "stores",
      label: "Stores",
      value: stores.length,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-1 px-3 py-4 sm:px-4 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-rose-100 bg-rose-50 text-rose-700 shadow-sm">
              <Shield className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-700 ring-1 ring-inset ring-rose-100">
                Private admin
              </div>
              <h1 className="font-satoshi text-3xl font-bold text-dark">
                {BRAND.controlRoomLabel}
              </h1>
              <p className="font-satoshi mt-2 max-w-3xl text-sm leading-6 text-gray-6">
                Store workspaces, elevated user accounts, scratch catalog
                imports, and pack value settings.
              </p>
            </div>
          </div>

          {isUnlocked ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshPortalData()}
                disabled={isRefreshingPortalData}
                className="inline-flex items-center gap-2 rounded-lg border border-stroke bg-white px-3 py-2 text-sm font-semibold text-dark shadow-sm transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isRefreshingPortalData ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isRefreshingPortalData ? "Refreshing" : "Refresh data"}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
              >
                <LogOut className="h-4 w-4" />
                Lock portal
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {portalStats.map((stat) => {
            const Icon = stat.icon;

            return (
              <StatCard
                key={stat.label}
                label={stat.label}
                value={stat.value}
                change={stat.detail}
                detail={stat.label === "Inactive games" ? "admin catalog" : ""}
                tone={stat.tone}
                icon={<Icon className="h-5 w-5" />}
              />
            );
          })}
        </div>

        {credentialNotice ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">
                  Temporary admin password generated
                </p>
                <div className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-xs">
                  {credentialNotice.temporaryPassword}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    credentialNotice.temporaryPassword,
                  )
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
              >
                <Copy className="h-4 w-4" />
                Copy password
              </button>
            </div>
          </div>
        ) : null}

        {!isUnlocked ? (
          <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.75fr)] lg:items-center">
            <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-6 shadow-sm">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100">
                <Lock className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-xl font-black text-slate-950">
                Master password required
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                This route controls store setup, elevated user accounts, and
                lottery game metadata. Unlocking starts a short private admin
                session for this browser.
              </p>
            </div>
            <SectionCard
              title="Unlock"
              description="Master password required."
              className={COMPACT_CARD_CLASS}
              headerClassName={COMPACT_HEADER_CLASS}
              contentClassName={COMPACT_CONTENT_CLASS}
            >
              <form className="space-y-3" onSubmit={handleUnlock}>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-dark">
                    Master password
                  </span>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="password"
                      value={masterPassword}
                      onChange={(event) =>
                        setMasterPassword(event.target.value)
                      }
                      placeholder="Enter the portal password"
                      autoComplete="current-password"
                      required
                      className="w-full rounded-lg border border-stroke bg-white py-2 pl-9 pr-3 text-sm text-dark outline-none transition focus:border-rose-500"
                    />
                  </div>
                </label>

                <button
                  type="button"
                  onClick={() => void submitUnlock()}
                  disabled={isSubmittingPassword}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmittingPassword ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <KeyRound className="h-5 w-5" />
                  )}
                  Unlock portal
                </button>
              </form>
            </SectionCard>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-20 rounded-full border border-stroke bg-white/95 p-1 shadow-sm backdrop-blur">
              <div className="grid gap-2 md:grid-cols-3">
                {portalViews.map((view) => {
                  const Icon = view.icon;
                  const isActive = activeView === view.id;

                  return (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => setActiveView(view.id)}
                      className={`flex items-center gap-3 rounded-full px-3 py-2.5 text-left transition ${
                        isActive
                          ? "bg-rose-600 text-white shadow-lg"
                          : "text-dark-5 hover:bg-gray-2 hover:text-dark"
                      }`}
                    >
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
                          isActive
                            ? "bg-white/15 text-white ring-white/20"
                            : "bg-rose-50 text-rose-700 ring-rose-100"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold">
                          {view.label}
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-xs ${
                            isActive ? "text-rose-50" : "text-dark-5"
                          }`}
                        >
                          {view.value} records / {view.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeView === "admins" ? (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
                <SectionCard
                  title="Admin accounts"
                  description="Create and review elevated users."
                  className={`${COMPACT_CARD_CLASS} ${isAdminFormOpen ? "" : "xl:col-span-2"}`}
                  headerClassName={COMPACT_HEADER_CLASS}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openNewAdminForm}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        New admin
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadAdmins()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Lock
                      </button>
                    </div>
                  }
                  contentClassName={COMPACT_STACK_CONTENT_CLASS}
                >
                  {isLoadingAdmins ? (
                    <div className="flex min-h-28 items-center justify-center text-sm text-dark-5">
                      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                      Loading admin accounts...
                    </div>
                  ) : admins.length === 0 ? (
                    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-stroke bg-gray-1/60 px-4 text-center">
                      <UserCog className="mb-2 h-8 w-8 text-slate-400" />
                      <p className="font-semibold text-dark">
                        No admin accounts found
                      </p>
                      <p className="mt-1 max-w-sm text-xs text-dark-5">
                        Create the first admin account.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-stroke">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Admin</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Updated</TableHead>
                            <TableHead className="text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {admins.map((admin) => (
                            <TableRow key={admin.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-dark">
                                    {admin.fullName}
                                  </p>
                                  <p className="text-sm text-dark-5">
                                    {admin.email}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <StatusBadge tone={getStatusTone(admin.status)}>
                                  {admin.status}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="text-sm text-dark-5">
                                {formatTimestamp(admin.updatedAt)}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleEditAdmin(admin)}
                                    className="app-icon-button app-icon-button-accent"
                                    aria-label={`Edit ${admin.fullName}`}
                                    title={`Edit ${admin.fullName}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteAdmin(admin)
                                    }
                                    className="app-icon-button app-danger-icon-button"
                                    aria-label={`Delete ${admin.fullName}`}
                                    title={`Delete ${admin.fullName}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </SectionCard>

                {isAdminFormOpen ? (
                  <SectionCard
                    title={editingAdminId ? "Edit admin" : "Create admin"}
                    description={
                      editingAdminId
                        ? "Update login details."
                        : "Leave password blank to auto-generate."
                    }
                    className={COMPACT_CARD_CLASS}
                    headerClassName={COMPACT_HEADER_CLASS}
                    contentClassName={COMPACT_CONTENT_CLASS}
                    action={
                      <button
                        type="button"
                        onClick={resetForm}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        <X className="h-3.5 w-3.5" />
                        Close
                      </button>
                    }
                  >
                    <form className="space-y-3" onSubmit={handleSaveAdmin}>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Full name
                        </span>
                        <input
                          type="text"
                          value={formState.fullName}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              fullName: event.target.value,
                            }))
                          }
                          placeholder="Alex Morgan"
                          required
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Email
                        </span>
                        <input
                          type="email"
                          value={formState.email}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                          placeholder="admin@company.com"
                          required
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Status
                        </span>
                        <select
                          value={formState.status}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              status: event.target.value as AdminStatus,
                            }))
                          }
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="on-leave">On leave</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          {editingAdminId ? "New password" : "Initial password"}
                        </span>
                        <input
                          type="text"
                          value={formState.password}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          placeholder={
                            editingAdminId
                              ? "Leave blank to keep current password"
                              : "Leave blank to auto-generate"
                          }
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        />
                      </label>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="submit"
                          disabled={isSavingAdmin}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isSavingAdmin ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" />
                          ) : editingAdminId ? (
                            <Shield className="h-5 w-5" />
                          ) : (
                            <Plus className="h-5 w-5" />
                          )}
                          {editingAdminId ? "Save changes" : "Create admin"}
                        </button>

                        <button
                          type="button"
                          onClick={resetForm}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke px-3 py-2 text-sm font-semibold text-dark transition hover:border-rose-300 hover:text-rose-700"
                        >
                          Reset form
                        </button>
                      </div>
                    </form>
                  </SectionCard>
                ) : null}
              </div>
            ) : null}

            {activeView === "catalog" ? (
              <div className="grid gap-4">
                <div className="order-1 rounded-xl border border-stroke bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-dark">
                        Game Catalog
                      </p>
                      <p className="text-xs text-dark-5">
                        Import PDF games and cropped artwork.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPackSettingsMinimized(true);
                        setIsGameCatalogFormOpen((current) => !current);
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
                    >
                      {isGameCatalogFormOpen ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {isGameCatalogFormOpen ? "Close" : "Import PDF"}
                    </button>
                  </div>
                </div>

                <div className="order-3 rounded-xl border border-stroke bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-rose-700 ring-1 ring-stroke">
                        <Ticket className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-dark">
                          Pack value settings
                        </p>
                        <p className="text-xs text-dark-5">
                          Set tickets per pack by ticket price.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setIsPackSettingsMinimized((current) => !current)
                        }
                        aria-expanded={!isPackSettingsMinimized}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stroke bg-white px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        {isPackSettingsMinimized ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isPackSettingsMinimized ? "Show" : "Hide"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadGameCatalogSettings()}
                        disabled={isLoadingGameCatalogSettings}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stroke bg-white px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isLoadingGameCatalogSettings ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Refresh
                      </button>
                    </div>
                  </div>

                  {isPackSettingsMinimized ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Price rows
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {gameCatalogPriceSettings.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Configured
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {configuredPackSettingCount} /{" "}
                          {gameCatalogPriceSettings.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Status
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {isLoadingGameCatalogSettings
                            ? "Refreshing"
                            : `${mixedPackSettingCount} mixed`}
                        </p>
                      </div>
                    </div>
                  ) : isLoadingGameCatalogSettings ? (
                    <div className="mt-3 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stroke bg-white text-sm text-dark-5">
                      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                      Loading pack settings...
                    </div>
                  ) : gameCatalogPriceSettings.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-stroke bg-white px-3 py-6 text-center text-sm text-dark-5">
                      Import the game catalog to create ticket price rows.
                    </div>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded-lg border border-stroke bg-white">
                      <Table rowsPerPage={5}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Ticket price</TableHead>
                            <TableHead>Games</TableHead>
                            <TableHead className="text-right">
                              Tickets per pack
                            </TableHead>
                            <TableHead className="text-right">
                              Pack value
                            </TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gameCatalogPriceSettings.map((setting) => {
                            const priceKey = getPriceSettingKey(
                              setting.ticketPrice,
                            );
                            const draftValue =
                              ticketCountDrafts[priceKey] ?? "";
                            const draftTicketCount = Number(draftValue);
                            const hasValidDraft =
                              Number.isInteger(draftTicketCount) &&
                              draftTicketCount >= 1 &&
                              draftTicketCount <= 1000;
                            const hasChanged =
                              hasValidDraft &&
                              draftTicketCount !== setting.ticketCount;
                            const packValue = hasValidDraft
                              ? setting.ticketPrice * draftTicketCount
                              : setting.packValue;
                            const isSaving =
                              savingTicketCountPrice === priceKey;

                            return (
                              <TableRow key={priceKey}>
                                <TableCell className="font-semibold text-dark">
                                  {formatCurrency(setting.ticketPrice)}
                                </TableCell>
                                <TableCell className="text-sm text-dark-5">
                                  {setting.activeGameCount} active /{" "}
                                  {setting.gameCount} total
                                </TableCell>
                                <TableCell className="text-right">
                                  <input
                                    type="number"
                                    min="1"
                                    max="1000"
                                    step="1"
                                    value={draftValue}
                                    onChange={(event) =>
                                      handleTicketCountDraftChange(
                                        setting,
                                        event.target.value,
                                      )
                                    }
                                    aria-label={`${formatCurrency(setting.ticketPrice)} tickets per pack`}
                                    className="ml-auto w-24 rounded-lg border border-stroke bg-white px-3 py-2 text-right text-sm font-semibold text-dark outline-none transition focus:border-rose-500"
                                  />
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold text-dark">
                                  {packValue ? formatCurrency(packValue) : "-"}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge
                                    tone={
                                      setting.ticketCount
                                        ? setting.hasMixedTicketCounts
                                          ? "amber"
                                          : "green"
                                        : "red"
                                    }
                                  >
                                    {setting.ticketCount
                                      ? setting.hasMixedTicketCounts
                                        ? "mixed"
                                        : "set"
                                      : "missing"}
                                  </StatusBadge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleSaveTicketCount(setting)
                                      }
                                      disabled={
                                        isSaving ||
                                        !hasValidDraft ||
                                        !hasChanged
                                      }
                                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isSaving ? (
                                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Ticket className="h-3.5 w-3.5" />
                                      )}
                                      Save
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {isGameCatalogFormOpen ||
                gameCatalogImportPreview ||
                gameCatalogImportWarnings.length > 0 ? (
                  <SectionCard
                    title="Game Catalog Import"
                    description="Preview extracted games before saving."
                    className={`${COMPACT_CARD_CLASS} order-2`}
                    headerClassName={COMPACT_HEADER_CLASS}
                    contentClassName={COMPACT_CONTENT_CLASS}
                  >
                    <div className="space-y-4">
                      {isGameCatalogFormOpen ? (
                        <form
                          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
                          onSubmit={handlePreviewGameCatalog}
                        >
                          <label className="block min-w-0">
                            <span className="mb-1 block text-xs font-medium text-dark">
                              Catalog PDF
                            </span>
                            <input
                              type="file"
                              accept=".pdf,application/pdf"
                              onChange={(event) => {
                                setGameCatalogFile(
                                  event.target.files?.[0] ?? null,
                                );
                                setGameCatalogImportPreview(null);
                                setGameCatalogImportWarnings([]);
                              }}
                              className="block w-full text-sm text-dark file:mr-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-rose-700"
                            />
                            {gameCatalogFile ? (
                              <p className="mt-2 truncate text-xs font-medium text-dark-5">
                                {gameCatalogFile.name}
                              </p>
                            ) : null}
                          </label>

                          <button
                            type="submit"
                            disabled={
                              !gameCatalogFile ||
                              isImportingGameCatalog ||
                              isSavingGameCatalogImport
                            }
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {isImportingGameCatalog ? (
                              <LoaderCircle className="h-5 w-5 animate-spin" />
                            ) : (
                              <Upload className="h-5 w-5" />
                            )}
                            {isImportingGameCatalog ? "Extracting" : "Preview"}
                          </button>
                        </form>
                      ) : null}

                      {gameCatalogImportPreview ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-dark">
                                Review extracted catalog
                              </p>
                              <p className="text-xs text-dark-5">
                                {gameCatalogImportPreview.games.length} games /{" "}
                                {gameCatalogImportPreview.prizeCount} prize rows
                                / {gameCatalogImportPreview.existingCount}{" "}
                                updates / {gameCatalogImportPreview.newCount}{" "}
                                new
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleConfirmGameCatalogImport()
                                }
                                disabled={isSavingGameCatalogImport}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                {isSavingGameCatalogImport ? (
                                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Ticket className="h-3.5 w-3.5" />
                                )}
                                Save to database
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setGameCatalogImportPreview(null);
                                  setGameCatalogImportWarnings([]);
                                }}
                                disabled={isSavingGameCatalogImport}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stroke bg-white px-3 py-2 text-xs font-semibold text-dark transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <X className="h-3.5 w-3.5" />
                                Cancel
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {gameCatalogImportPreview.games.map((game) => (
                              <div
                                key={game.gameId}
                                className="rounded-lg border border-stroke bg-white p-2"
                              >
                                <div className="flex gap-2">
                                  <Image
                                    src={game.imageDataUrl}
                                    alt={game.gameName}
                                    width={96}
                                    height={60}
                                    unoptimized
                                    className="h-[60px] w-24 shrink-0 rounded-md border border-stroke bg-white object-contain"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-dark">
                                          {game.gameName}
                                        </p>
                                        <p className="text-xs text-dark-5">
                                          #{game.gameId} /{" "}
                                          {formatCurrency(game.ticketPrice)}
                                        </p>
                                      </div>
                                      <StatusBadge
                                        tone={
                                          game.existingGame ? "amber" : "green"
                                        }
                                      >
                                        {game.existingGame ? "update" : "new"}
                                      </StatusBadge>
                                    </div>
                                    <p className="mt-1 text-xs text-dark-5">
                                      Page {game.sourcePage} / {game.prizeCount}{" "}
                                      prizes
                                    </p>
                                  </div>
                                </div>
                                {game.existingGame ? (
                                  <p className="mt-2 truncate rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                                    Existing: {game.existingGame.gameName} /{" "}
                                    {formatCurrency(
                                      game.existingGame.ticketPrice,
                                    )}
                                  </p>
                                ) : null}
                                {game.prizes.length > 0 ? (
                                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                                    {game.prizes.slice(0, 4).map((prize) => (
                                      <div
                                        key={`${game.gameId}-${prize.prizeRank}`}
                                        className="rounded-md bg-slate-50 px-2 py-1"
                                      >
                                        <span className="font-semibold text-dark">
                                          {prize.prizeAmount}
                                        </span>{" "}
                                        <span className="text-dark-5">
                                          / {prize.remainingCount}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {gameCatalogImportWarnings.length > 0 ? (
                        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="min-w-0 space-y-1">
                            <p className="font-semibold">
                              Catalog import warnings
                            </p>
                            {gameCatalogImportWarnings.map((warning, index) => (
                              <p key={`${warning}-${index}`}>{warning}</p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </SectionCard>
                ) : null}

                <div className="order-4 rounded-xl border border-stroke bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-dark">
                        Games ledger
                      </p>
                      <p className="text-xs text-dark-5">
                        {gameCatalogGames.length} game
                        {gameCatalogGames.length === 1 ? "" : "s"} in the
                        catalog.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-medium text-dark-5">
                        Active {activeGameCount} / inactive {inactiveGameCount}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setIsGamesLedgerMinimized((current) => !current)
                        }
                        aria-expanded={!isGamesLedgerMinimized}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stroke bg-white px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        {isGamesLedgerMinimized ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isGamesLedgerMinimized ? "Show" : "Hide"}
                      </button>
                    </div>
                  </div>

                  {isGamesLedgerMinimized ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Total games
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {gameCatalogGames.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Active
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {activeGameCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-stroke bg-white px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase text-dark-5">
                          Inactive
                        </p>
                        <p className="mt-1 text-sm font-bold text-dark">
                          {inactiveGameCount}
                        </p>
                      </div>
                    </div>
                  ) : isLoadingGameCatalogSettings ? (
                    <div className="mt-3 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stroke bg-white text-sm text-dark-5">
                      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                      Loading games ledger...
                    </div>
                  ) : gameCatalogGames.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-stroke bg-white px-3 py-6 text-center text-sm text-dark-5">
                      Import the game catalog to populate the games ledger.
                    </div>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded-lg border border-stroke bg-white">
                      <Table rowsPerPage={6}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Image</TableHead>
                            <TableHead>Game</TableHead>
                            <TableHead>Game ID</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">
                              Pack tickets
                            </TableHead>
                            <TableHead className="text-right">
                              Pack value
                            </TableHead>
                            <TableHead className="text-right">Source</TableHead>
                            <TableHead>Imported</TableHead>
                            <TableHead className="text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gameCatalogGames.map((game) => {
                            const isEditing = editingGameId === game.gameId;
                            const editState = isEditing
                              ? gameLedgerEditState
                              : null;
                            const ticketPrice = Number(
                              editState?.ticketPrice ?? game.ticketPrice,
                            );
                            const ticketCountDraft =
                              editState?.ticketCount ??
                              game.ticketCount?.toString() ??
                              "";
                            const ticketCount =
                              ticketCountDraft.trim().length > 0
                                ? Number(ticketCountDraft)
                                : null;
                            const previewPackValue =
                              Number.isFinite(ticketPrice) &&
                              ticketPrice > 0 &&
                              ticketCount !== null &&
                              Number.isInteger(ticketCount) &&
                              ticketCount > 0
                                ? ticketPrice * ticketCount
                                : game.packValue;
                            const isSaving = savingGameId === game.gameId;

                            return (
                              <TableRow key={game.id}>
                                <TableCell>
                                  {game.imageUrl ? (
                                    <Image
                                      src={game.imageUrl}
                                      alt={game.gameName}
                                      width={112}
                                      height={64}
                                      unoptimized
                                      className="h-16 w-28 rounded-md border border-stroke bg-white object-contain"
                                    />
                                  ) : (
                                    <div className="flex h-16 w-28 items-center justify-center rounded-md border border-dashed border-stroke bg-slate-50 text-xs text-dark-5">
                                      No image
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="font-medium text-dark">
                                  {isEditing && editState ? (
                                    <input
                                      type="text"
                                      value={editState.gameName}
                                      onChange={(event) =>
                                        setGameLedgerEditState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                gameName: event.target.value,
                                              }
                                            : current,
                                        )
                                      }
                                      className="w-56 rounded-lg border border-stroke bg-white px-3 py-2 text-sm font-medium text-dark outline-none transition focus:border-rose-500"
                                      aria-label={`Game name for ${game.gameId}`}
                                    />
                                  ) : (
                                    game.gameName
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-sm text-dark">
                                  #{game.gameId}
                                </TableCell>
                                <TableCell>
                                  {isEditing && editState ? (
                                    <select
                                      value={editState.isActive}
                                      onChange={(event) =>
                                        setGameLedgerEditState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                isActive: event.target.value as
                                                  | "active"
                                                  | "inactive",
                                              }
                                            : current,
                                        )
                                      }
                                      className="rounded-lg border border-stroke bg-white px-3 py-2 text-sm font-medium text-dark outline-none transition focus:border-rose-500"
                                      aria-label={`Status for ${game.gameId}`}
                                    >
                                      <option value="active">Active</option>
                                      <option value="inactive">Inactive</option>
                                    </select>
                                  ) : (
                                    <StatusBadge
                                      tone={game.isActive ? "green" : "red"}
                                    >
                                      {game.isActive ? "active" : "inactive"}
                                    </StatusBadge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm text-dark-5">
                                  {isEditing && editState ? (
                                    <CurrencyInput
                                      value={editState.ticketPrice}
                                      onValueChange={(decimalValue) =>
                                        setGameLedgerEditState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                ticketPrice: decimalValue,
                                              }
                                            : current,
                                        )
                                      }
                                      className="ml-auto w-24 rounded-lg border border-stroke bg-white px-3 py-2 text-right text-sm font-semibold text-dark outline-none transition focus:border-rose-500"
                                      aria-label={`Ticket price for ${game.gameId}`}
                                    />
                                  ) : (
                                    formatCurrency(game.ticketPrice)
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm text-dark-5">
                                  {isEditing && editState ? (
                                    <input
                                      type="number"
                                      min="1"
                                      max="1000"
                                      step="1"
                                      value={editState.ticketCount}
                                      onChange={(event) =>
                                        setGameLedgerEditState((current) =>
                                          current
                                            ? {
                                                ...current,
                                                ticketCount: event.target.value,
                                              }
                                            : current,
                                        )
                                      }
                                      className="ml-auto w-24 rounded-lg border border-stroke bg-white px-3 py-2 text-right text-sm font-semibold text-dark outline-none transition focus:border-rose-500"
                                      aria-label={`Pack tickets for ${game.gameId}`}
                                    />
                                  ) : (
                                    (game.ticketCount ?? "-")
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold text-dark">
                                  {previewPackValue
                                    ? formatCurrency(previewPackValue)
                                    : "-"}
                                </TableCell>
                                <TableCell className="text-right text-sm text-dark-5">
                                  {game.sourcePage
                                    ? `p${game.sourcePage}${game.cropIndex ? ` #${game.cropIndex}` : ""}`
                                    : "-"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm text-dark-5">
                                  {formatTimestamp(game.importedAt)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-2">
                                    {isEditing ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleSaveGame(game)
                                          }
                                          disabled={isSaving}
                                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                          {isSaving ? (
                                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <Ticket className="h-3.5 w-3.5" />
                                          )}
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={handleCancelGameEdit}
                                          disabled={isSaving}
                                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleEditGame(game)}
                                        className="app-icon-button app-icon-button-accent"
                                        aria-label={`Edit ${game.gameName}`}
                                        title={`Edit ${game.gameName}`}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeView === "stores" ? (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
                <SectionCard
                  title="Store workspaces"
                  description="Create, update, and delete store records."
                  className={`${COMPACT_CARD_CLASS} ${isStoreFormOpen ? "" : "xl:col-span-2"}`}
                  headerClassName={COMPACT_HEADER_CLASS}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openNewStoreForm}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        New store
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadStores()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                      </button>
                    </div>
                  }
                  contentClassName={COMPACT_STACK_CONTENT_CLASS}
                >
                  {isLoadingStores ? (
                    <div className="flex min-h-28 items-center justify-center text-sm text-dark-5">
                      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                      Loading stores...
                    </div>
                  ) : stores.length === 0 ? (
                    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-stroke bg-gray-1/60 px-4 text-center">
                      <Store className="mb-2 h-8 w-8 text-slate-400" />
                      <p className="font-semibold text-dark">No stores found</p>
                      <p className="mt-1 max-w-sm text-xs text-dark-5">
                        Create the first store workspace.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-stroke">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Store</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Timezone</TableHead>
                            <TableHead>Bins</TableHead>
                            <TableHead>EFT</TableHead>
                            <TableHead>Updated</TableHead>
                            <TableHead className="text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stores.map((store) => (
                            <TableRow key={store.storeKey}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-dark">
                                    {store.name}
                                  </p>
                                  <p className="text-sm text-dark-5">
                                    {store.storeKey}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <StatusBadge
                                  tone={getStoreStatusTone(store.status)}
                                >
                                  {store.status}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="font-mono text-sm text-dark-5">
                                {store.timeZone}
                              </TableCell>
                              <TableCell className="text-sm font-semibold text-dark">
                                {store.scratchBinCount}
                              </TableCell>
                              <TableCell className="text-xs text-dark-5">
                                <div>
                                  Comm {store.lotteryRetailerCommissionRate}%
                                </div>
                                <div>
                                  Payout {store.lotteryCashingBonusRate}%
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-dark-5">
                                {formatTimestamp(
                                  store.updatedAt,
                                  store.timeZone,
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleEditStore(store)}
                                    className="app-icon-button app-icon-button-accent"
                                    aria-label={`Edit ${store.name}`}
                                    title={`Edit ${store.name}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteStore(store)
                                    }
                                    disabled={
                                      store.storeKey === "default" ||
                                      deletingStoreKey === store.storeKey
                                    }
                                    className="app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label={`Delete ${store.name}`}
                                    title={
                                      store.storeKey === "default"
                                        ? "Default store cannot be deleted"
                                        : `Delete ${store.name}`
                                    }
                                  >
                                    {deletingStoreKey === store.storeKey ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </SectionCard>

                {isStoreFormOpen ? (
                  <SectionCard
                    title={editingStoreKey ? "Edit store" : "Create store"}
                    description={
                      editingStoreKey
                        ? "Update workspace details."
                        : "Create a selectable store workspace."
                    }
                    className={COMPACT_CARD_CLASS}
                    headerClassName={COMPACT_HEADER_CLASS}
                    contentClassName={COMPACT_CONTENT_CLASS}
                    action={
                      <button
                        type="button"
                        onClick={resetStoreForm}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-dark transition hover:border-rose-300 hover:text-rose-700"
                      >
                        <X className="h-3.5 w-3.5" />
                        Close
                      </button>
                    }
                  >
                    <form className="space-y-3" onSubmit={handleSaveStore}>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Store name
                        </span>
                        <input
                          type="text"
                          value={storeFormState.name}
                          onChange={(event) =>
                            setStoreFormState((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="Downtown Market"
                          required
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Store key
                        </span>
                        <input
                          type="text"
                          value={storeFormState.storeKey}
                          onChange={(event) =>
                            setStoreFormState((current) => ({
                              ...current,
                              storeKey: event.target.value,
                            }))
                          }
                          placeholder="downtown_market"
                          required
                          readOnly={Boolean(editingStoreKey)}
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 font-mono text-sm text-dark outline-none transition read-only:bg-gray-1/60 read-only:text-dark-5 focus:border-rose-500"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Status
                        </span>
                        <select
                          value={storeFormState.status}
                          onChange={(event) =>
                            setStoreFormState((current) => ({
                              ...current,
                              status: event.target.value as StoreStatus,
                            }))
                          }
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-dark">
                          Timezone
                        </span>
                        <input
                          type="text"
                          list="store-timezone-options"
                          value={storeFormState.timeZone}
                          onChange={(event) =>
                            setStoreFormState((current) => ({
                              ...current,
                              timeZone: event.target.value,
                            }))
                          }
                          placeholder="America/New_York"
                          required
                          className="w-full rounded-lg border border-stroke bg-white px-3 py-2 font-mono text-sm text-dark outline-none transition focus:border-rose-500"
                        />
                        <datalist id="store-timezone-options">
                          {COMMON_TIME_ZONES.map((timeZone) => (
                            <option key={timeZone} value={timeZone} />
                          ))}
                        </datalist>
                        <p className="mt-1 text-xs text-dark-5">
                          Use an IANA timezone.
                        </p>
                      </label>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-dark">
                            Till opening float
                          </span>
                          <CurrencyInput
                            value={storeFormState.openingFloat}
                            onValueChange={(decimalValue) =>
                              setStoreFormState((current) => ({
                                ...current,
                                openingFloat: decimalValue,
                              }))
                            }
                            placeholder="500.00"
                            required
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-dark">
                            Till closing float
                          </span>
                          <CurrencyInput
                            value={storeFormState.closingFloat}
                            onValueChange={(decimalValue) =>
                              setStoreFormState((current) => ({
                                ...current,
                                closingFloat: decimalValue,
                              }))
                            }
                            placeholder="500.00"
                            required
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-dark">
                            Scratch bins
                          </span>
                          <input
                            type="number"
                            min="1"
                            max="200"
                            step="1"
                            value={storeFormState.scratchBinCount}
                            onChange={(event) =>
                              setStoreFormState((current) => ({
                                ...current,
                                scratchBinCount: event.target.value,
                              }))
                            }
                            placeholder="40"
                            required
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                          />
                        </label>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-dark">
                            Retailer commission %
                          </span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={storeFormState.lotteryRetailerCommissionRate}
                            onChange={(event) =>
                              setStoreFormState((current) => ({
                                ...current,
                                lotteryRetailerCommissionRate:
                                  event.target.value,
                              }))
                            }
                            placeholder="0"
                            required
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-dark">
                            Payout commission %
                          </span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={storeFormState.lotteryCashingBonusRate}
                            onChange={(event) =>
                              setStoreFormState((current) => ({
                                ...current,
                                lotteryCashingBonusRate: event.target.value,
                              }))
                            }
                            placeholder="0"
                            required
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-rose-500"
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="submit"
                          disabled={isSavingStore}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isSavingStore ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" />
                          ) : editingStoreKey ? (
                            <Store className="h-5 w-5" />
                          ) : (
                            <Plus className="h-5 w-5" />
                          )}
                          {editingStoreKey ? "Save changes" : "Create store"}
                        </button>

                        <button
                          type="button"
                          onClick={resetStoreForm}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke px-3 py-2 text-sm font-semibold text-dark transition hover:border-rose-300 hover:text-rose-700"
                        >
                          Reset form
                        </button>
                      </div>
                    </form>
                  </SectionCard>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
