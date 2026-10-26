"use strict";
(() => {
  const api = window.diyComposer,
    $ = (id) => document.getElementById(id);
  let targetId = null;
  api.get().then(({ draft, tools }) => {
    targetId = draft.targetId;
    for (const t of tools) $("tool").add(new Option(t.name, t.id));
    $("tool").value = draft.toolId;
    $("model").value = draft.model || "";
    $("request").value = draft.request || "";
    $("request").focus();
  });
  $("close").onclick = () => api.close();
  $("generate").onclick = async () => {
    try {
      $("generate").disabled = true;
      await api.start({
        toolId: $("tool").value,
        model: $("model").value.trim(),
        request: $("request").value,
        targetId,
      });
      await api.close();
    } catch (e) {
      $("status").textContent = e.message;
      $("generate").disabled = false;
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.close();
    if (e.key === "Enter" && e.ctrlKey && !e.isComposing) $("generate").click();
  });
})();
