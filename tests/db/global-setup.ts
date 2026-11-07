import { requireTestTarget } from "../support/env-guard";

// Runs once before any DB test file. Throws (and so stops the whole run) unless the
// target is the staging project. Test files call requireTestTarget() again in their workers.
export default function setup() {
  requireTestTarget();
}
