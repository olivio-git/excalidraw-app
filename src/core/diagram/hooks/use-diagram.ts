import { useDiagramStore } from "../store/diagram-store";

export const useDiagram = (instanceId: string | undefined) => {
  const diagram = useDiagramStore((s) => (instanceId ? s.diagrams[instanceId] : undefined));
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const updateDiagram = useDiagramStore((s) => s.updateDiagram);
  const saveDiagram = useDiagramStore((s) => s.saveDiagram);
  const closeDiagram = useDiagramStore((s) => s.closeDiagram);

  return { diagram, loadDiagram, updateDiagram, saveDiagram, closeDiagram };
};
