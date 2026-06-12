import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/layout/PageHeader";
import { CATEGORY_GROUPS, categoryGroupLabel, defaultIncludeForCategory, mergeInventoryCategories } from "@/lib/inventoryCategories";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

const lowerName = (name) => String(name || "").trim().toLowerCase();

const categoryDraggableId = (category) => lowerName(category.name);

const categoryEditKey = (category) =>
  category.id ? `id:${category.id}` : `name:${lowerName(category.name)}`;

export default function InventorySettings() {
  const { user, companyId } = useAuth();
  const [categoryRows, setCategoryRows] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryGroup, setNewCategoryGroup] = useState("ingredient");
  const [categoryNameDrafts, setCategoryNameDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "admin";

  const categories = useMemo(
    () => mergeInventoryCategories(categoryRows, catalogItems),
    [categoryRows, catalogItems]
  );
  const activeCategories = categories.filter((category) => category.is_active !== false);

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [cats, items] = await Promise.all([
        base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []),
        base44.entities.InventoryItem.filter({ company_id: companyId }).catch(() => []),
      ]);
      setCategoryRows(cats);
      setCatalogItems(items);
      setCategoryNameDrafts({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [companyId]);

  const updateCategoryLocal = (name, patch) => {
    const key = lowerName(name);
    setCategoryRows((current) => {
      const existing = current.find((row) => lowerName(row.name) === key);
      if (existing) {
        return current.map((row) => (lowerName(row.name) === key ? { ...row, ...patch } : row));
      }
      const fallback = categories.find((category) => lowerName(category.name) === key);
      return [
        ...current,
        {
          id: fallback?.id || null,
          company_id: companyId,
          name,
          main_category: fallback?.main_category || "ingredient",
          include_in_recipe_pricing: fallback?.include_in_recipe_pricing !== false,
          is_active: true,
          sort_order: fallback?.sort_order ?? current.length,
          ...patch,
        },
      ];
    });
  };

  const replaceActiveCategories = (nextActiveCategories) => {
    const inactiveCategories = categories.filter((category) => category.is_active === false);
    setCategoryRows([
      ...inactiveCategories,
      ...nextActiveCategories,
    ].map((category, index) => ({
      ...category,
      company_id: companyId,
      sort_order: category.sort_order ?? index,
    })));
  };

  const categoryPayload = (category, index) => ({
    company_id: companyId,
    name: category.name.trim(),
    main_category: category.main_category || "ingredient",
    include_in_recipe_pricing: category.include_in_recipe_pricing !== false,
    is_active: category.is_active !== false,
    sort_order: index,
  });

  const categoryDisplayName = (category) =>
    categoryNameDrafts[categoryEditKey(category)] ?? category.name;

  const updateCategoryNameDraft = (category, name) => {
    const key = categoryEditKey(category);
    setCategoryNameDrafts((current) => ({ ...current, [key]: name }));
  };

  const rememberSavedCategories = (savedRows) => {
    setCategoryRows((current) => {
      const byName = new Map(current.map((category) => [lowerName(category.name), category]));
      for (const row of savedRows) {
        byName.set(lowerName(row.name), row);
      }
      return [...byName.values()];
    });
  };

  const suppressDefaultCategoryName = async (category, previousName, index, excludeId) => {
    if (!category.is_default || lowerName(previousName) === lowerName(category.name)) return;

    const payload = {
      company_id: companyId,
      name: previousName.trim(),
      main_category: category.main_category || "ingredient",
      include_in_recipe_pricing: false,
      is_active: false,
      sort_order: index,
    };
    const freshRows = await base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []);
    const existing = freshRows.find((row) =>
      row.id !== excludeId && lowerName(row.name) === lowerName(previousName)
    );

    if (existing?.id) {
      await base44.entities.InventoryCategory.update(existing.id, payload);
    } else {
      await base44.entities.InventoryCategory.create(payload);
    }
  };

  const saveCategoryRecord = async (category, index, previousName = category.name) => {
    const payload = categoryPayload(category, index);
    const previousKey = lowerName(previousName);
    const payloadKey = lowerName(payload.name);
    const localExisting = category.id
      ? category
      : categoryRows.find((row) => lowerName(row.name) === previousKey) ||
        categoryRows.find((row) => lowerName(row.name) === payloadKey);

    if (localExisting?.id) {
      const saved = await base44.entities.InventoryCategory.update(localExisting.id, payload);
      await suppressDefaultCategoryName(category, previousName, index, saved.id);
      return saved;
    }

    try {
      const saved = await base44.entities.InventoryCategory.create(payload);
      await suppressDefaultCategoryName(category, previousName, index, saved.id);
      return saved;
    } catch (error) {
      const freshRows = await base44.entities.InventoryCategory.filter({ company_id: companyId }).catch(() => []);
      const freshExisting = freshRows.find((row) =>
        lowerName(row.name) === previousKey || lowerName(row.name) === payloadKey
      );
      if (!freshExisting?.id) throw error;
      const saved = await base44.entities.InventoryCategory.update(freshExisting.id, payload);
      await suppressDefaultCategoryName(category, previousName, index, saved.id);
      return saved;
    }
  };

  const updateItemsForCategoryRename = async (previousName, nextName) => {
    if (lowerName(previousName) === lowerName(nextName)) return;
    const affectedItems = catalogItems.filter((item) => lowerName(item.category) === lowerName(previousName));
    await Promise.all(
      affectedItems.map((item) => base44.entities.InventoryItem.update(item.id, { category: nextName }))
    );
  };

  const handleCategoryDragEnd = ({ source, destination, draggableId }) => {
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const grouped = Object.fromEntries(
      CATEGORY_GROUPS.map((group) => [
        group.value,
        activeCategories
          .filter((category) => category.main_category === group.value)
          .map((category) => ({ ...category })),
      ])
    );

    const sourceList = grouped[source.droppableId] || [];
    const destinationList = grouped[destination.droppableId] || [];
    const sourceIndex = sourceList.findIndex((category) => categoryDraggableId(category) === draggableId);
    if (sourceIndex < 0) return;

    const [moved] = sourceList.splice(sourceIndex, 1);
    const nextMoved = {
      ...moved,
      main_category: destination.droppableId,
      include_in_recipe_pricing: moved.include_in_recipe_pricing ?? defaultIncludeForCategory(destination.droppableId),
    };

    if (source.droppableId === destination.droppableId) {
      sourceList.splice(destination.index, 0, nextMoved);
    } else {
      destinationList.splice(destination.index, 0, nextMoved);
    }

    const nextActiveCategories = CATEGORY_GROUPS.flatMap((group) =>
      (grouped[group.value] || []).map((category, index) => ({
        ...category,
        sort_order: index,
      }))
    );
    replaceActiveCategories(nextActiveCategories);
  };

  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const existing = categories.find((category) => lowerName(category.name) === lowerName(name));
    if (existing && existing.is_active !== false) {
      toast.error("That category already exists");
      return;
    }

    const draft = {
      name,
      main_category: newCategoryGroup,
      include_in_recipe_pricing: defaultIncludeForCategory(newCategoryGroup),
      is_active: true,
      sort_order: categories.length + 1,
    };

    updateCategoryLocal(name, draft);
    setNewCategoryName("");

    setSaving(true);
    try {
      const saved = await saveCategoryRecord(draft, categories.length + 1);
      rememberSavedCategories([saved]);
      toast.success("Category added");
      await load();
    } catch (error) {
      toast.error(error.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = (category) => {
    const draftKey = categoryEditKey(category);
    setCategoryNameDrafts((current) => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
    updateCategoryLocal(category.name, {
      is_active: false,
      include_in_recipe_pricing: false,
    });
  };

  const itemCountForCategory = (name) =>
    catalogItems.filter((item) => lowerName(item.category) === lowerName(name)).length;

  const saveCategories = async () => {
    setSaving(true);
    try {
      const categoriesToSave = categories.map((category) => ({
        ...category,
        previous_name: category.name,
        name: categoryDisplayName(category).trim() || category.name,
      }));
      const activeNames = categoriesToSave
        .filter((category) => category.is_active !== false)
        .map((category) => lowerName(category.name));
      const hasDuplicateName = activeNames.some((name, index) => name && activeNames.indexOf(name) !== index);
      if (hasDuplicateName) {
        toast.error("Two active categories cannot use the same name");
        return;
      }

      const saved = [];
      for (const [index, category] of categoriesToSave.entries()) {
        const row = await saveCategoryRecord(category, index, category.previous_name);
        await updateItemsForCategoryRename(category.previous_name, category.name);
        saved.push(row);
      }
      setCategoryRows(saved);
      setCategoryNameDrafts({});
      toast.success("Categories saved");
      await load();
    } catch (error) {
      toast.error(error.message || "Failed to save categories");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader title="Inventory Settings" subtitle="Company inventory configuration" />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Only company admins can change inventory settings.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="Inventory Settings"
        subtitle="Manage inventory categories. Per-location inventory settings now live in the location's control panel (Settings → Locations)."
        actions={
          <Button
            onClick={saveCategories}
            disabled={saving || loading}
            className="gap-1.5"
          >
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Settings"}
          </Button>
        }
      />

      <Card>
          <CardHeader>
            <CardTitle>Inventory Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid md:grid-cols-[1fr_180px_auto] gap-2 items-end">
              <div>
                <Label>Subcategory</Label>
                <Input className="mt-1" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Sauces" />
              </div>
              <div>
                <Label>Upper Category</Label>
                <Select value={newCategoryGroup} onValueChange={setNewCategoryGroup}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_GROUPS.map((group) => (
                      <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" className="gap-1" onClick={addCategory} disabled={saving || !newCategoryName.trim()}>
                <Plus className="w-4 h-4" /> {saving ? "Saving..." : "Add"}
              </Button>
            </div>

            <DragDropContext onDragEnd={handleCategoryDragEnd}>
              <div className="space-y-5">
                {CATEGORY_GROUPS.map((group) => {
                  const groupCategories = activeCategories.filter((category) => category.main_category === group.value);
                  return (
                    <section key={group.value} className="border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border">
                        <h2 className="text-sm font-semibold">{group.label}</h2>
                      </div>
                      <Droppable droppableId={group.value}>
                        {(dropProvided, dropSnapshot) => (
                          <div
                            ref={dropProvided.innerRef}
                            {...dropProvided.droppableProps}
                            className={`divide-y divide-border min-h-14 transition-colors ${dropSnapshot.isDraggingOver ? "bg-primary/5" : ""}`}
                          >
                            {groupCategories.length === 0 ? (
                              <p className="px-4 py-4 text-sm text-muted-foreground">Drop categories here.</p>
                            ) : groupCategories.map((category, index) => {
                              const itemCount = itemCountForCategory(category.name);
                              return (
                                <Draggable key={category.name} draggableId={categoryDraggableId(category)} index={index}>
                                  {(dragProvided, dragSnapshot) => (
                                    <div
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      style={dragProvided.draggableProps.style}
                                      className={`grid grid-cols-[32px_1fr] lg:grid-cols-[32px_1fr_180px_190px_80px_auto] gap-3 items-center px-4 py-3 bg-card ${dragSnapshot.isDragging ? "shadow-lg ring-1 ring-primary/30" : ""}`}
                                    >
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                        aria-label={`Drag ${category.name}`}
                                        {...dragProvided.dragHandleProps}
                                      >
                                        <GripVertical className="w-4 h-4" />
                                      </button>
                                      <div>
                                        <Input
                                          className="h-9 text-sm font-medium"
                                          value={categoryDisplayName(category)}
                                          onChange={(event) => updateCategoryNameDraft(category, event.target.value)}
                                          disabled={saving}
                                        />
                                        <p className="text-xs text-muted-foreground">{itemCount} catalog item{itemCount === 1 ? "" : "s"}</p>
                                      </div>
                                      <Select
                                        value={category.main_category}
                                        onValueChange={(main_category) => updateCategoryLocal(category.name, {
                                          main_category,
                                          include_in_recipe_pricing: category.include_in_recipe_pricing ?? defaultIncludeForCategory(main_category),
                                        })}
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {CATEGORY_GROUPS.map((entry) => (
                                            <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <label className="flex items-center gap-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={category.include_in_recipe_pricing !== false}
                                          onChange={(event) => updateCategoryLocal(category.name, { include_in_recipe_pricing: event.target.checked })}
                                        />
                                        Recipes & Pricing
                                      </label>
                                      <span className="text-xs text-muted-foreground">{categoryGroupLabel(category.main_category)}</span>
                                      <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeCategory(category)}>
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {dropProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </section>
                  );
                })}
              </div>
            </DragDropContext>
          </CardContent>
        </Card>
    </div>
  );
}
