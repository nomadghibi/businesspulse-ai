import assert from "node:assert/strict";
import { createInMemoryStorageForTests } from "../server/storage";
import { DEMO_ORG_ID } from "../server/utils";

const storage = createInMemoryStorageForTests();
await storage.initialize();

const badLogin = await storage.login("owner@businesspulse.local", "wrongpass");
assert.equal(badLogin, null, "invalid password must fail");

const owner = await storage.login("owner@businesspulse.local", "demo1234");
assert.ok(owner, "owner login should succeed");
assert.equal(owner?.role, "owner");
assert.equal(owner?.mustChangePassword, false);

const invited = await storage.inviteUser(DEMO_ORG_ID, "viewer1@businesspulse.local", "viewer", "viewer1234");
assert.ok(invited.userId.startsWith("user_"));

const users = await storage.listUsers(DEMO_ORG_ID);
assert.ok(users.some((user) => user.email === "viewer1@businesspulse.local"), "invited user should be listed");

await storage.setUserRole(DEMO_ORG_ID, invited.userId, "admin");
const afterRole = await storage.listUsers(DEMO_ORG_ID);
assert.equal(afterRole.find((user) => user.userId === invited.userId)?.role, "admin");

await storage.setUserDisabled(DEMO_ORG_ID, invited.userId, true);
const disabledLogin = await storage.login("viewer1@businesspulse.local", "viewer1234");
assert.equal(disabledLogin, null, "disabled user should not log in");

const tokenUser = await storage.getAuthUser(owner!.token);
assert.equal(tokenUser?.organizationId, DEMO_ORG_ID, "session should retain org scope");

const trial = await storage.createTrialWorkspace({ email: "new.owner@company.com", company: "NewCo", source: "landing" });
assert.equal(trial.organizationName, "NewCo");
const trialLogin = await storage.login(trial.ownerEmail, trial.temporaryPassword);
assert.ok(trialLogin, "trial owner should be able to log in with temporary password");
assert.equal(trialLogin?.mustChangePassword, true);
await storage.changePassword(trialLogin!.organizationId, trialLogin!.userId, trial.temporaryPassword, "newsecure123");
const trialLoginAfter = await storage.login(trial.ownerEmail, "newsecure123");
assert.ok(trialLoginAfter);
assert.equal(trialLoginAfter?.mustChangePassword, false);

console.log("security.test.ts passed");
