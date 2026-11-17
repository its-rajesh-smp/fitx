import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { config } from "../config";
import { resourceName } from "../utils/naming";

interface DatabaseArgs {
  subnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
}

export interface Database {
  host: pulumi.Output<string>;
  port: pulumi.Output<number>;
  name: string;
  username: string;
  password: pulumi.Output<string>;
}

/** Private, encrypted RDS Postgres instance reachable only from the API tasks. */
export const createDatabase = ({ subnetIds, securityGroupId }: DatabaseArgs): Database => {
  const db = config.database;

  // RDS forbids '/', '@', '"' and spaces in the master password; alphanumerics keep it simple.
  const password = new random.RandomPassword(resourceName("db-password"), {
    length: 32,
    special: false,
  });

  const subnetGroup = new aws.rds.SubnetGroup(resourceName("db-subnets"), {
    subnetIds,
    description: "Isolated subnets for FitX Postgres",
  });

  const instance = new aws.rds.Instance(
    resourceName("postgres"),
    {
      identifierPrefix: `${resourceName("pg")}-`,
      engine: "postgres",
      engineVersion: db.engineVersion,
      instanceClass: db.instanceClass,
      allocatedStorage: db.allocatedStorage,
      maxAllocatedStorage: db.maxAllocatedStorage,
      storageType: "gp3",
      storageEncrypted: true,

      dbName: db.name,
      username: db.username,
      password: password.result,

      dbSubnetGroupName: subnetGroup.name,
      vpcSecurityGroupIds: [securityGroupId],
      publiclyAccessible: false,
      multiAz: db.multiAz,

      backupRetentionPeriod: db.backupRetentionDays,
      copyTagsToSnapshot: true,
      deletionProtection: db.deletionProtection,
      skipFinalSnapshot: db.skipFinalSnapshot,
      finalSnapshotIdentifier: resourceName("postgres-final"),

      autoMinorVersionUpgrade: true,
      applyImmediately: false,
    },
    { protect: db.deletionProtection },
  );

  return {
    host: instance.address,
    port: instance.port,
    name: db.name,
    username: db.username,
    password: password.result,
  };
};
