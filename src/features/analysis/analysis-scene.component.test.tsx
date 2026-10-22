import { expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { AnalysisScene } from "./analysis-scene";

it("keeps the previous report under an open native detail page instead of replacing it with loading", async () => {
  const screen = await render(
    <AnalysisScene focused>
      <Text>Jahresbericht 2030</Text>
    </AnalysisScene>,
  );
  await screen.rerender(
    <AnalysisScene focused={false}>
      <Text>Wird geladen</Text>
    </AnalysisScene>,
  );
  expect(screen.getByText("Jahresbericht 2030")).toBeTruthy();
  expect(screen.queryByText("Wird geladen")).toBeNull();
  await screen.rerender(
    <AnalysisScene focused>
      <Text>Jahresbericht 2030 aktualisiert</Text>
    </AnalysisScene>,
  );
  expect(screen.getByText("Jahresbericht 2030 aktualisiert")).toBeTruthy();
});

it("keeps live values and explicit failures current while the page is focused", async () => {
  const screen = await render(
    <AnalysisScene focused>
      <Text>Monatsbericht</Text>
    </AnalysisScene>,
  );
  await screen.rerender(
    <AnalysisScene focused>
      <Text>Prüfung nicht verfügbar</Text>
    </AnalysisScene>,
  );
  expect(screen.getByText("Prüfung nicht verfügbar")).toBeTruthy();
});
