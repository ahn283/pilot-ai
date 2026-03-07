/**
 * Builds an XML block describing available tools for the LLM.
 * The LLM can interpret natural language commands and decide which
 * tool/function to invoke. These descriptions are injected into the prompt.
 */
export function buildToolDescriptions(): string {
  return `<AVAILABLE_TOOLS>
<tool name="addCronJob">
  <description>Add a new scheduled (cron) job. The LLM should parse natural language schedule requests into cron expressions.</description>
  <params>
    <param name="cron" type="string">5-field cron expression (min hour dom mon dow)</param>
    <param name="command" type="string">Command or task to execute</param>
    <param name="project" type="string" optional="true">Project name</param>
  </params>
</tool>
<tool name="removeCronJob">
  <description>Remove a scheduled job by ID.</description>
  <params>
    <param name="id" type="number">Job ID</param>
  </params>
</tool>
<tool name="toggleCronJob">
  <description>Enable or disable a scheduled job by ID.</description>
  <params>
    <param name="id" type="number">Job ID</param>
  </params>
</tool>
<tool name="listCronJobs">
  <description>List all scheduled jobs.</description>
</tool>
<tool name="createSkill">
  <description>Create a new skill (reusable procedure the agent can follow).</description>
  <params>
    <param name="name" type="string">Skill name</param>
    <param name="trigger" type="string">When to trigger this skill (natural language description)</param>
    <param name="steps" type="string">Step-by-step procedure</param>
    <param name="reference" type="string" optional="true">Additional notes or constraints</param>
  </params>
</tool>
<tool name="deleteSkill">
  <description>Delete a skill by name.</description>
  <params>
    <param name="name" type="string">Skill name</param>
  </params>
</tool>
<tool name="listSkills">
  <description>List all registered skills.</description>
</tool>
</AVAILABLE_TOOLS>`;
}
