///
/// Copyright © 2016-2025 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { TranslateService } from '@ngx-translate/core';
import enUS from '../../assets/locale/locale.constant-en_US.json';
import arAE from '../../assets/locale/locale.constant-ar_AE.json';
import bnBD from '../../assets/locale/locale.constant-bn_BD.json';
import bnIN from '../../assets/locale/locale.constant-bn_IN.json';
import brxIN from '../../assets/locale/locale.constant-brx_IN.json';
import caES from '../../assets/locale/locale.constant-ca_ES.json';
import csCZ from '../../assets/locale/locale.constant-cs_CZ.json';
import daDK from '../../assets/locale/locale.constant-da_DK.json';
import deDE from '../../assets/locale/locale.constant-de_DE.json';
import dzBT from '../../assets/locale/locale.constant-dz_BT.json';
import elGR from '../../assets/locale/locale.constant-el_GR.json';
import esES from '../../assets/locale/locale.constant-es_ES.json';
import faIR from '../../assets/locale/locale.constant-fa_IR.json';
import filPH from '../../assets/locale/locale.constant-fil_PH.json';
import frFR from '../../assets/locale/locale.constant-fr_FR.json';
import guIN from '../../assets/locale/locale.constant-gu_IN.json';
import heIL from '../../assets/locale/locale.constant-he_IL.json';
import hiIN from '../../assets/locale/locale.constant-hi_IN.json';
import idID from '../../assets/locale/locale.constant-id_ID.json';
import itIT from '../../assets/locale/locale.constant-it_IT.json';
import jaJP from '../../assets/locale/locale.constant-ja_JP.json';
import kaGE from '../../assets/locale/locale.constant-ka_GE.json';
import kmKH from '../../assets/locale/locale.constant-km_KH.json';
import koKR from '../../assets/locale/locale.constant-ko_KR.json';
import kokIN from '../../assets/locale/locale.constant-kok_IN.json';
import ltLT from '../../assets/locale/locale.constant-lt_LT.json';
import lvLV from '../../assets/locale/locale.constant-lv_LV.json';
import mlIN from '../../assets/locale/locale.constant-ml_IN.json';
import nlBE from '../../assets/locale/locale.constant-nl_BE.json';
import plPL from '../../assets/locale/locale.constant-pl_PL.json';
import ptBR from '../../assets/locale/locale.constant-pt_BR.json';
import slSI from '../../assets/locale/locale.constant-sl_SI.json';
import trTR from '../../assets/locale/locale.constant-tr_TR.json';
import viVN from '../../assets/locale/locale.constant-vi_VN.json';
import zhCN from '../../assets/locale/locale.constant-zh_CN.json';
import zhTW from '../../assets/locale/locale.constant-zh_TW.json';
import { isLiteralObject, mergeDeep } from '@core/public-api';

export enum AvailableLanguages {
  English = 'en_US',
  Arabic = 'ar_AE',
  bn_BD = 'bn_BD',
  bn_IN = 'bn_IN',
  brx_IN = 'brx_IN',
  Catalan = 'ca_ES',
  Czech = 'cs_CZ',
  Danish = 'da_DK',
  de_DE = 'de_DE',
  Dzongkha = 'dz_BT',
  el_GR = 'el_GR',
  Spanish = 'es_ES',
  fa_IR = 'fa_IR',
  fil_PH = 'fil_PH',
  fr_FR = 'fr_FR',
  gu_IN = 'gu_IN',
  he_IL = 'he_IL',
  Hindi = 'hi_IN',
  id_ID = 'id_ID',
  it_IT = 'it_IT',
  ja_JP = 'ja_JP',
  ka_GE = 'ka_GE',
  km_KH = 'km_KH',
  Korean = 'ko_KR',
  kok_IN = 'kok_IN',
  Lithuanian = 'lt_LT',
  lv_LV = 'lv_LV',
  ml_IN = 'ml_IN',
  Dutch = 'nl_BE',
  Polish = 'pl_PL',
  PortugueseBrazil = 'pt_BR',
  Slovenian = 'sl_SI',
  Turkish = 'tr_TR',
  Vietnamese = 'vi_VN',
  ChineseSimplified = 'zh_CN',
  ChineseTraditional = 'zh_TW'
}

type LocaleData = Record<string, any>;

const languagesMap = new Map<AvailableLanguages, LocaleData>([
  [AvailableLanguages.English, enUS],
  [AvailableLanguages.Arabic, arAE],
  [AvailableLanguages.bn_BD, bnBD],
  [AvailableLanguages.bn_IN, bnIN],
  [AvailableLanguages.brx_IN, brxIN],
  [AvailableLanguages.Catalan, caES],
  [AvailableLanguages.Czech, csCZ],
  [AvailableLanguages.Danish, daDK],
  [AvailableLanguages.de_DE, deDE],
  [AvailableLanguages.Dzongkha, dzBT],
  [AvailableLanguages.el_GR, elGR],
  [AvailableLanguages.Spanish, esES],
  [AvailableLanguages.fa_IR, faIR],
  [AvailableLanguages.fil_PH, filPH],
  [AvailableLanguages.fr_FR, frFR],
  [AvailableLanguages.gu_IN, guIN],
  [AvailableLanguages.he_IL, heIL],
  [AvailableLanguages.Hindi, hiIN],
  [AvailableLanguages.id_ID, idID],
  [AvailableLanguages.it_IT, itIT],
  [AvailableLanguages.ja_JP, jaJP],
  [AvailableLanguages.ka_GE, kaGE],
  [AvailableLanguages.km_KH, kmKH],
  [AvailableLanguages.Korean, koKR],
  [AvailableLanguages.kok_IN, kokIN],
  [AvailableLanguages.Lithuanian, ltLT],
  [AvailableLanguages.lv_LV, lvLV],
  [AvailableLanguages.ml_IN, mlIN],
  [AvailableLanguages.Dutch, nlBE],
  [AvailableLanguages.Polish, plPL],
  [AvailableLanguages.PortugueseBrazil, ptBR],
  [AvailableLanguages.Slovenian, slSI],
  [AvailableLanguages.Turkish, trTR],
  [AvailableLanguages.Vietnamese, viVN],
  [AvailableLanguages.ChineseSimplified, zhCN],
  [AvailableLanguages.ChineseTraditional, zhTW]
]);

export const addGatewayLocale = (translate: TranslateService) => {
  const EN = AvailableLanguages.English;
  const lang = (translate.currentLang as AvailableLanguages) ?? EN;

  // Merge the compiled gateway locale into the ACTIVE language, layering:
  //   1. English  — fallback so any key without a translation in `lang`
  //      renders English text instead of the raw `gateway.*` key;
  //   2. the active language's compiled gateway strings (override the fallback);
  //   3. whatever the runtime already loaded for that language (e.g. the few
  //      gateway keys shipped in the host UI's locale asset).
  // Always target `lang` — never fall back to mutating English — and the caller
  // re-runs this on every language change (including switches *to* English),
  // so the gateway namespace is rebuilt whenever the host reloads a locale.
  const sources = [
    languagesMap.get(EN)?.gateway,
    languagesMap.get(lang)?.gateway,
    // Already-loaded runtime translations: once the host has loaded a locale, the
    // ngx-translate messageformat compiler has REPLACED every string with a compiled
    // function. Feeding those functions back into setTranslation makes the compiler
    // call String.prototype.replace on a function ("e.replace is not a function").
    // Keep only the raw string leaves; host-only keys still survive in
    // translate.translations and the merge below preserves them.
    onlyStringLeaves(translate.translations[lang]?.gateway)
  ].filter(isNonEmptyObject);

  if (!sources.length) return;
  const merged = sources.length === 1 ? sources[0] : mergeDeep({}, ...sources);
  translate.setTranslation(lang, { gateway: merged }, true);
};

const isNonEmptyObject = (v: any) =>
  isLiteralObject(v) && Object.keys(v).length !== 0;

// Deep-copy an object keeping only string leaves — drops compiled-function values
// (and any other non-string leaf) so the result is safe to (re)compile.
const onlyStringLeaves = (obj: any): any => {
  if (!isLiteralObject(obj)) {
    return undefined;
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string') {
      result[key] = value;
    } else if (isLiteralObject(value)) {
      const nested = onlyStringLeaves(value);
      if (nested && Object.keys(nested).length) {
        result[key] = nested;
      }
    }
  }
  return result;
};
