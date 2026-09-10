import type { IfcDataStore } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import { collectRelatedEntities, StepExporter, type StepExportResult } from '@ifc-lite/export';

/** What gets carried along with the elements the user picked. */
export interface PluckOptions {
  /** Property and quantity sets attached to the picked elements. */
  properties: boolean;
  /** Openings cut into picked hosts, and the doors/windows that fill them. */
  hosted: boolean;
  /** Type objects (IfcWallType, IfcDoorType, …) the picked elements are defined by. */
  types: boolean;
  /** Material assignments. */
  materials: boolean;
  /** Assemblies and their parts (IfcRelAggregates / IfcRelNests). */
  parts: boolean;
}

export const DEFAULT_PLUCK_OPTIONS: PluckOptions = {
  properties: true,
  hosted: true,
  types: true,
  materials: true,
  parts: true,
};

export interface PluckResult {
  /** The new IFC file, as STEP bytes. */
  content: Uint8Array;
  /** Every entity id the export was seeded with. */
  entityIds: Set<number>;
  stats: StepExportResult['stats'];
  /** True when relationship expansion hit its work budget before finishing. */
  truncated: boolean;
}

/**
 * The picked elements plus the context they need to stay meaningful on their own:
 * spatial containment up to IfcProject (always), and whatever `options` asks for.
 */
export function collectPluckSet(store: IfcDataStore, selection: Iterable<number>, options: PluckOptions) {
  const seeds = [...new Set(selection)];
  // Picked hosts bring their openings and the doors/windows filling them. The same walk
  // started from a picked door or window would climb to its host wall and on to that
  // wall's other openings, so those seeds are expanded without the opening relationships.
  const hosts = new Set(
    options.hosted ? seeds.filter((id) => store.relationships.getRelated(id, RelationshipType.VoidsElement, 'forward').length > 0) : [],
  );
  const walks = [
    { ids: seeds.filter((id) => hosts.has(id)), hosted: true },
    { ids: seeds.filter((id) => !hosts.has(id)), hosted: false },
  ]
    .filter((walk) => walk.ids.length > 0)
    .map((walk) =>
      collectRelatedEntities(store, walk.ids, {
        IfcRelContainedInSpatialStructure: true,
        IfcRelVoidsElement: walk.hosted,
        IfcRelFillsElement: walk.hosted,
        IfcRelAggregates: options.parts ? 'both' : 'none',
        IfcRelNests: options.parts ? 'down' : 'none',
        IfcRelDefinesByType: options.types,
        IfcRelAssociatesMaterial: options.materials,
        IfcRelDefinesByProperties: options.properties,
      }),
    );
  return {
    all: new Set(walks.flatMap((walk) => [...walk.all])),
    truncated: walks.some((walk) => walk.truncated),
  };
}

/** Extract `selection` from `store` into a new, standalone IFC file. */
export function pluck(store: IfcDataStore, selection: Iterable<number>, options: PluckOptions = DEFAULT_PLUCK_OPTIONS): PluckResult {
  const related = collectPluckSet(store, selection, options);
  const result = new StepExporter(store).export({
    schema: store.schemaVersion,
    application: 'IFCpluck',
    subsetEntityIds: related.all,
    // Keep addresses and georeferencing: the plucked model should sit exactly where the source model does.
    subsetIdentifyingTypes: new Set(),
    includeProperties: options.properties,
    includeQuantities: options.properties,
  });
  return { content: result.content, entityIds: related.all, stats: result.stats, truncated: related.truncated };
}
