import { useState } from "react";
import { View } from "react-native";
import type { SpecialDuty } from "@/domain/special-duty";
import {
  newStandbyAgreement,
  type StandbyAgreement,
  STANDBY_TARIFFS,
} from "@/domain/standby-agreement";
import type { DutyTariffFamily } from "@/engine/special-duty-tariff";
import { standbyGroupOptions } from "@/engine/standby-hourly-rate";
import { DutyValueRow } from "./special-duty-controls";
import { DutyChoice } from "./special-duty-choice";
import { Field } from "@/ui/form-controls";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";

const names = {
  TVOED_K: "TVöD Krankenhaus",
  TVOED_B: "TVöD Pflege/Betreuung",
  TVL_43: "TV-L Pflege",
  TVH_43: "TV-H Pflege",
  TVUK: "TV-UK",
};

export function StandbyAgreementFields({
  value,
  tariffFamily,
  template,
  onChange,
}: {
  readonly value: SpecialDuty;
  readonly tariffFamily: DutyTariffFamily | null;
  readonly template: boolean;
  readonly onChange: (next: SpecialDuty) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rateText, setRateText] = useState(
    value.standbyAgreement?.hourlyCents == null
      ? ""
      : String(value.standbyAgreement.hourlyCents / 100).replace(".", ","),
  );
  const palette = usePalette();
  const tariff = tariffFamily ?? value.standbyAgreement?.tariff ?? null;
  const agreement = value.standbyAgreement ?? (tariff ? newStandbyAgreement(tariff) : null);
  const ownRate = agreement?.rateMode === "AGREED";
  const update = (next: StandbyAgreement) =>
    onChange({ ...value, version: 2, standbyAgreement: next });
  const monthlySequence = tariff === "TVOED_B" || tariff === "TVL_43" || tariff === "TVH_43";
  return (
    <>
      <DutyValueRow
        label="Abrechnung"
        value={
          open
            ? "Schließen"
            : agreement?.rule && agreement.rule !== "UNKNOWN"
              ? "Grundlage bearbeiten"
              : "Angaben ergänzen"
        }
        onPress={() => setOpen(!open)}
        expanded={open}
      />
      {open ? (
        <View style={{ gap: 8, padding: 12 }}>
          {tariffFamily ? (
            <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
              Tarif aus deinem Profil: {names[tariffFamily]}
            </Text>
          ) : null}
          {!tariffFamily ? (
            <DutyChoice
              label="Tarifbereich der Bereitschaft"
              value={tariff ?? "UNKNOWN"}
              options={[
                { value: "UNKNOWN", label: "Bitte wählen" },
                ...STANDBY_TARIFFS.map((value) => ({ value, label: names[value] })),
              ]}
              onChange={(next) => {
                if (next !== "UNKNOWN") {
                  setRateText("");
                  update(newStandbyAgreement(next as DutyTariffFamily));
                }
              }}
            />
          ) : null}
          {agreement && tariff ? (
            <>
              {agreement.tariff !== tariff ? (
                <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                  Dein Tarif hat sich geändert. Wähle die Abrechnungsgrundlage erneut.
                </Text>
              ) : null}
              <DutyChoice
                label="Bewertung laut Arbeitgeber"
                value={agreement.tariff === tariff ? agreement.rule : "UNKNOWN"}
                options={[
                  { value: "UNKNOWN", label: "Weiß ich noch nicht" },
                  { value: "STANDARD", label: "Reguläre Bewertung" },
                  ...(tariff === "TVOED_K" || tariff === "TVOED_B"
                    ? [{ value: "CARE", label: "Betreuung nach §45 Abs.10" }]
                    : []),
                ]}
                onChange={(rule) =>
                  update({
                    ...(agreement.tariff === tariff ? agreement : newStandbyAgreement(tariff)),
                    tariff,
                    rule: rule as StandbyAgreement["rule"],
                  })
                }
              />
              {monthlySequence && !template ? (
                <Field
                  label="Nummer der Bereitschaft im Monat"
                  keyboardType="number-pad"
                  value={agreement.sequence === null ? "" : String(agreement.sequence)}
                  onChangeText={(text) => {
                    if (text === "" || (/^[1-9]\d{0,2}$/.test(text) && Number(text) <= 100))
                      update({ ...agreement, sequence: text === "" ? null : Number(text) });
                  }}
                />
              ) : null}
              {monthlySequence && template ? (
                <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                  Die Monatsnummer ergänzt du später im Kalendereintrag.
                </Text>
              ) : null}
              {standbyGroupOptions(tariff).length && !ownRate ? (
                <DutyChoice
                  label="Bereitschaftsgruppe laut Arbeitgeber"
                  value={agreement.payGroup ?? "AUTO"}
                  options={[
                    {
                      value: "AUTO",
                      label: tariff === "TVOED_B" ? "Aus Tarifprofil" : "Weiß ich noch nicht",
                    },
                    ...standbyGroupOptions(tariff),
                  ]}
                  onChange={(payGroup) =>
                    update({ ...agreement, payGroup: payGroup === "AUTO" ? null : payGroup })
                  }
                />
              ) : null}
              {(tariff === "TVL_43" || tariff === "TVH_43") && !ownRate ? (
                <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                  Die Bereitschaftsgruppe kann von deiner aktuellen KR-Gruppe abweichen.
                </Text>
              ) : null}
              <DutyValueRow
                stacked
                label="Stundenentgelt"
                value={ownRate ? "Laut Arbeitgeber" : "Aus Tariftabelle"}
                onPress={() => {
                  setRateText("");
                  update({
                    ...agreement,
                    rateMode: ownRate ? "TABLE" : "AGREED",
                    hourlyCents: null,
                  });
                }}
              />
              {ownRate ? (
                <>
                  <Field
                    label="Stundenentgelt vor Bewertung (€)"
                    keyboardType="decimal-pad"
                    value={rateText}
                    onChangeText={(text) => {
                      if (!/^\d{0,4}([,.]\d{0,2})?$/.test(text)) return;
                      setRateText(text);
                      const cents = Math.round(Number(text.replace(",", ".")) * 100);
                      update({
                        ...agreement,
                        hourlyCents: text !== "" && cents >= 1 && cents <= 100000 ? cents : null,
                      });
                    }}
                  />
                  <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                    Für individuelle Zuordnungen und Ausbildung: den bestätigten Stundensatz vor der
                    Bereitschaftsbewertung eintragen.
                  </Text>
                </>
              ) : null}
              {value.settlement === "TIME_OFF" ? (
                <DutyChoice
                  label="Vereinbarter Freizeitausgleich"
                  value={agreement.timeOffMode}
                  options={[
                    { value: "UNKNOWN", label: "Weiß ich noch nicht" },
                    {
                      value: "WEIGHTED",
                      label:
                        tariff === "TVL_43" || tariff === "TVH_43"
                          ? "Gewertete Zeit 1:1"
                          : "Gewertete Zeit und umwandelbare Zuschläge",
                    },
                    ...(tariff === "TVOED_K"
                      ? [{ value: "FACTORIZED", label: "Faktorisierung nach §46 Abs.9" }]
                      : []),
                  ]}
                  onChange={(timeOffMode) =>
                    update({
                      ...agreement,
                      timeOffMode: timeOffMode as StandbyAgreement["timeOffMode"],
                    })
                  }
                />
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
