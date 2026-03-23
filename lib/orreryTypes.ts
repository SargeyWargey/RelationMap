// Ring/belt sub-type: wraps a planet's equator or orbits as an asteroid belt around a star
export type RingSubType = "planet-rings" | "star-belt";

export type RingDatabaseMapping = {
  databaseId: string;
  subType: RingSubType;
};

export type TierMapping = {
  galaxyDatabaseId: string;
  starDatabaseId: string;
  planetDatabaseId: string;
  moonDatabaseId: string;
  ringDatabases: RingDatabaseMapping[]; // empty array = no rings configured
};

export type OrreryConfig = {
  tierMapping: TierMapping;
  configuredAt: string; // ISO date string
};
