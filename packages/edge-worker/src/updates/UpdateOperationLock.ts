import { OwnedResourceClaim } from "bobs-factory-core/owned-resource-claim";

/** Retains the updater lock interface and conservative explicit recovery policy. */
export class UpdateOperationLock extends OwnedResourceClaim {}
