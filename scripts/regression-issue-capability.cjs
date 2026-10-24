"use strict";

async function canOpenRegressionIssue({ github, context, core }) {
  const { data: repository } = await github.rest.repos.get(context.repo);
  if (repository.has_issues === true) return true;
  if (repository.has_issues !== false) {
    throw new Error("Repository issue capability was not returned");
  }
  const run = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  core.warning("Regression alert remains in the job summary because repository Issues are disabled. The regression gate still fails.");
  await core.summary.addHeading("Critical regression alert")
    .addRaw("Repository Issues are disabled. Review the failed regression checks in this run. No repository settings were changed.\n\n")
    .addLink("Workflow evidence", run).write();
  return false;
}

module.exports = { canOpenRegressionIssue };
