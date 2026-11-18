/**
 * Conditions d'utilisation de la version bêta de TOT Stock (v5.17.0).
 * La version française fait foi ; les versions anglaise et néerlandaise sont fournies pour information.
 * Ces conditions complètent le « Contrat de mise en test – Partenariat TOT Stock » signé avec chaque testeur :
 * en cas de contradiction, le contrat signé prévaut.
 */
import type { Language } from '../i18n/translations';
import { BETA_CONTRACT_NAME, COPYRIGHT_HOLDER, COPYRIGHT_YEAR } from '../config/distribution';

export interface LegalSection {
  title: string;
  body: string[];
}

export interface LegalDocument {
  heading: string;
  betaNotice: string;
  intro: string;
  sections: LegalSection[];
  checkboxAccept: string;
  checkboxTester: string;
  acceptButton: string;
  declineButton: string;
  declinedMessage: string;
  binding: string;
  close: string;
}

const COPY = `© ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER}`;

export const LEGAL_DOCUMENTS: Record<Language, LegalDocument> = {
  fr: {
    heading: 'Conditions d’utilisation — Version bêta',
    betaNotice: `Version BÊTA réservée aux testeurs ayant signé le « ${BETA_CONTRACT_NAME} ».`,
    intro:
      'Avant d’utiliser TOT Stock, lisez ces conditions. Elles complètent le contrat de mise en test signé avec le Partenaire ; en cas de contradiction, le contrat signé prévaut.',
    sections: [
      {
        title: '1. Version bêta',
        body: [
          'TOT Stock est une version bêta en cours de développement : des fonctionnalités peuvent être modifiées, ajoutées ou retirées, et des anomalies peuvent subsister.',
          'Elle n’est pas destinée à une distribution de masse ni à une exploitation en production sans accord écrit.',
        ],
      },
      {
        title: '2. Accès réservé',
        body: [
          `L’accès est réservé aux testeurs désignés ayant signé le « ${BETA_CONTRACT_NAME} ». Le droit d’utilisation est personnel, non exclusif, non transférable et limité à la durée du test.`,
        ],
      },
      {
        title: '3. Propriété intellectuelle',
        body: [
          `${COPY}. Tous droits réservés. L’application, son code source, ses interfaces, sa documentation, sa base de données (structure des tables, fonctions et scripts), ses marques et ses logos sont protégés par le droit d’auteur et restent la propriété exclusive de ${COPYRIGHT_HOLDER}.`,
          'Aucun droit de propriété n’est cédé. Les données saisies par le testeur lui appartiennent.',
        ],
      },
      {
        title: '4. Interdictions',
        body: [
          'Sans accord écrit préalable de l’auteur, il est interdit de : copier, distribuer, redistribuer, publier, louer, prêter, vendre ou sous-licencier l’application ou ses fichiers d’installation ; la mettre à disposition de tiers ; la décompiler, la désassembler, en extraire le code ou en faire l’ingénierie inverse ; extraire, reproduire ou documenter la structure de la base de données (tables, fonctions, scripts, règles de sécurité) ; créer une œuvre dérivée ou une application similaire à partir de celle-ci.',
          'Toute distribution non autorisée est interdite et peut donner lieu à des poursuites.',
        ],
      },
      {
        title: '5. Absence de garantie',
        body: [
          'L’application est fournie « en l’état », sans garantie d’aucune sorte : ni d’absence d’erreur, ni de disponibilité continue, ni d’adéquation à un besoin particulier.',
        ],
      },
      {
        title: '6. Limitation de responsabilité',
        body: [
          `Dans les limites permises par la loi, ${COPYRIGHT_HOLDER} n’est pas responsable de la perte, de l’altération, de la fuite ou de l’indisponibilité des données, ni d’aucun autre dommage direct ou indirect (perte d’exploitation, manque à gagner, interruption d’activité, atteinte à l’image) lié à l’utilisation de la version bêta. Cette limitation ne s’applique pas en cas de dol ou lorsque la loi l’interdit.`,
          'Le testeur effectue ses propres sauvegardes, saisit de préférence des données de test et ne s’appuie pas sur l’application comme seul outil pour des opérations critiques.',
        ],
      },
      {
        title: '7. Données personnelles et confidentialité',
        body: [
          'Le traitement des données personnelles est encadré par le contrat de mise en test (RGPD). Les informations non publiques de l’application (fonctionnement, interfaces, feuille de route) sont confidentielles.',
        ],
      },
      {
        title: '8. Retours d’expérience',
        body: [
          'Les suggestions et remarques envoyées par le testeur peuvent être utilisées librement pour améliorer l’application, sans droit pour le testeur sur celle-ci.',
        ],
      },
      {
        title: '9. Suspension et fin',
        body: [
          'L’accès peut être suspendu ou retiré à tout moment en cas de non-respect de ces conditions. À la fin du test, l’application doit être désinstallée et l’accès est désactivé.',
        ],
      },
      {
        title: '10. Droit applicable',
        body: ['Ces conditions sont soumises au droit belge. La version française fait foi.'],
      },
    ],
    checkboxAccept:
      'J’ai lu et j’accepte les conditions d’utilisation de cette version bêta (propriété intellectuelle, interdiction de distribution, limitation de responsabilité).',
    checkboxTester: `Je confirme utiliser cette application dans le cadre du « ${BETA_CONTRACT_NAME} ».`,
    acceptButton: 'Accepter et continuer',
    declineButton: 'Refuser',
    declinedMessage:
      'Vous avez refusé les conditions : l’application ne peut pas être utilisée. Fermez cette fenêtre ou désinstallez l’application.',
    binding: 'La version française fait foi.',
    close: 'Fermer',
  },
  en: {
    heading: 'Terms of use — Beta version',
    betaNotice: `BETA version reserved for testers who signed the “${BETA_CONTRACT_NAME}” (test partnership agreement).`,
    intro:
      'Please read these terms before using TOT Stock. They supplement the test agreement signed with the Partner; if they conflict, the signed agreement prevails.',
    sections: [
      {
        title: '1. Beta version',
        body: [
          'TOT Stock is a beta version under development: features may be changed, added or removed, and defects may remain.',
          'It is not intended for mass distribution or production use without written agreement.',
        ],
      },
      {
        title: '2. Restricted access',
        body: [
          `Access is reserved for designated testers who signed the “${BETA_CONTRACT_NAME}”. The right of use is personal, non-exclusive, non-transferable and limited to the test period.`,
        ],
      },
      {
        title: '3. Intellectual property',
        body: [
          `${COPY}. All rights reserved. The application, its source code, interfaces, documentation, database (table structure, functions and scripts), trademarks and logos are protected by copyright and remain the exclusive property of ${COPYRIGHT_HOLDER}.`,
          'No ownership is transferred. Data entered by the tester belongs to the tester.',
        ],
      },
      {
        title: '4. Prohibited acts',
        body: [
          'Without the author’s prior written consent, you may not: copy, distribute, redistribute, publish, rent, lend, sell or sublicense the application or its installation files; make it available to third parties; decompile, disassemble, extract its code or reverse-engineer it; extract, reproduce or document the database structure (tables, functions, scripts, security rules); create a derivative work or a similar application from it.',
          'Any unauthorised distribution is prohibited and may lead to legal action.',
        ],
      },
      {
        title: '5. No warranty',
        body: [
          'The application is provided “as is”, without warranty of any kind: no warranty of error-free operation, continuous availability or fitness for a particular purpose.',
        ],
      },
      {
        title: '6. Limitation of liability',
        body: [
          `To the extent permitted by law, ${COPYRIGHT_HOLDER} is not liable for any loss, alteration, leak or unavailability of data, nor for any other direct or indirect damage (loss of business, loss of profit, business interruption, reputational harm) related to the use of the beta version. This limitation does not apply in case of wilful misconduct or where the law prohibits it.`,
          'The tester makes their own backups, preferably enters test data, and does not rely on the application as the only tool for critical operations.',
        ],
      },
      {
        title: '7. Personal data and confidentiality',
        body: [
          'Personal data processing is governed by the test agreement (GDPR). Non-public information about the application (operation, interfaces, roadmap) is confidential.',
        ],
      },
      {
        title: '8. Feedback',
        body: [
          'Suggestions and comments sent by the tester may be used freely to improve the application, without giving the tester any right in it.',
        ],
      },
      {
        title: '9. Suspension and end',
        body: [
          'Access may be suspended or withdrawn at any time if these terms are not respected. At the end of the test the application must be uninstalled and access is disabled.',
        ],
      },
      {
        title: '10. Governing law',
        body: ['These terms are governed by Belgian law. The French version prevails.'],
      },
    ],
    checkboxAccept:
      'I have read and accept the terms of use of this beta version (intellectual property, no distribution, limitation of liability).',
    checkboxTester: `I confirm that I use this application under the “${BETA_CONTRACT_NAME}”.`,
    acceptButton: 'Accept and continue',
    declineButton: 'Decline',
    declinedMessage:
      'You declined the terms: the application cannot be used. Close this window or uninstall the application.',
    binding: 'The French version prevails.',
    close: 'Close',
  },
  nl: {
    heading: 'Gebruiksvoorwaarden — Bètaversie',
    betaNotice: `BÈTAVERSIE voorbehouden aan testers die de “${BETA_CONTRACT_NAME}” (testovereenkomst) hebben ondertekend.`,
    intro:
      'Lees deze voorwaarden voordat u TOT Stock gebruikt. Ze vullen de met de Partner ondertekende testovereenkomst aan; bij tegenstrijdigheid gaat de ondertekende overeenkomst voor.',
    sections: [
      {
        title: '1. Bètaversie',
        body: [
          'TOT Stock is een bètaversie in ontwikkeling: functies kunnen worden gewijzigd, toegevoegd of verwijderd en fouten kunnen blijven bestaan.',
          'Ze is niet bedoeld voor massadistributie of productiegebruik zonder schriftelijk akkoord.',
        ],
      },
      {
        title: '2. Beperkte toegang',
        body: [
          `Toegang is voorbehouden aan aangewezen testers die de “${BETA_CONTRACT_NAME}” hebben ondertekend. Het gebruiksrecht is persoonlijk, niet-exclusief, niet-overdraagbaar en beperkt tot de testperiode.`,
        ],
      },
      {
        title: '3. Intellectuele eigendom',
        body: [
          `${COPY}. Alle rechten voorbehouden. De toepassing, de broncode, de interfaces, de documentatie, de database (tabelstructuur, functies en scripts), de merken en de logo’s zijn auteursrechtelijk beschermd en blijven de exclusieve eigendom van ${COPYRIGHT_HOLDER}.`,
          'Er wordt geen eigendom overgedragen. De door de tester ingevoerde gegevens blijven van de tester.',
        ],
      },
      {
        title: '4. Verboden handelingen',
        body: [
          'Zonder voorafgaande schriftelijke toestemming van de auteur is het verboden: de toepassing of haar installatiebestanden te kopiëren, te verspreiden, door te geven, te publiceren, te verhuren, uit te lenen, te verkopen of in sublicentie te geven; ze ter beschikking van derden te stellen; ze te decompileren, te disassembleren, de code eruit te halen of reverse engineering toe te passen; de databasestructuur (tabellen, functies, scripts, beveiligingsregels) te extraheren, te reproduceren of te documenteren; een afgeleid werk of een gelijkaardige toepassing eruit te maken.',
          'Elke niet-toegestane verspreiding is verboden en kan tot juridische stappen leiden.',
        ],
      },
      {
        title: '5. Geen garantie',
        body: [
          'De toepassing wordt geleverd “as is”, zonder enige garantie: geen garantie op foutloze werking, continue beschikbaarheid of geschiktheid voor een bepaald doel.',
        ],
      },
      {
        title: '6. Beperking van aansprakelijkheid',
        body: [
          `Voor zover de wet het toelaat, is ${COPYRIGHT_HOLDER} niet aansprakelijk voor verlies, wijziging, lek of onbeschikbaarheid van gegevens, noch voor enige andere directe of indirecte schade (bedrijfsverlies, gederfde winst, bedrijfsonderbreking, imagoschade) verbonden aan het gebruik van de bètaversie. Deze beperking geldt niet bij opzet of wanneer de wet dit verbiedt.`,
          'De tester maakt zelf back-ups, voert bij voorkeur testgegevens in en gebruikt de toepassing niet als enig hulpmiddel voor kritieke handelingen.',
        ],
      },
      {
        title: '7. Persoonsgegevens en vertrouwelijkheid',
        body: [
          'De verwerking van persoonsgegevens wordt geregeld door de testovereenkomst (AVG). Niet-openbare informatie over de toepassing (werking, interfaces, roadmap) is vertrouwelijk.',
        ],
      },
      {
        title: '8. Feedback',
        body: [
          'Suggesties en opmerkingen van de tester mogen vrij worden gebruikt om de toepassing te verbeteren, zonder dat de tester er rechten op krijgt.',
        ],
      },
      {
        title: '9. Opschorting en einde',
        body: [
          'De toegang kan op elk moment worden opgeschort of ingetrokken bij niet-naleving van deze voorwaarden. Na afloop van de test moet de toepassing worden verwijderd en wordt de toegang uitgeschakeld.',
        ],
      },
      {
        title: '10. Toepasselijk recht',
        body: ['Op deze voorwaarden is het Belgisch recht van toepassing. De Franse versie is doorslaggevend.'],
      },
    ],
    checkboxAccept:
      'Ik heb de gebruiksvoorwaarden van deze bètaversie gelezen en aanvaard ze (intellectuele eigendom, verbod op verspreiding, beperking van aansprakelijkheid).',
    checkboxTester: `Ik bevestig dat ik deze toepassing gebruik in het kader van de “${BETA_CONTRACT_NAME}”.`,
    acceptButton: 'Aanvaarden en doorgaan',
    declineButton: 'Weigeren',
    declinedMessage:
      'U hebt de voorwaarden geweigerd: de toepassing kan niet worden gebruikt. Sluit dit venster of verwijder de toepassing.',
    binding: 'De Franse versie is doorslaggevend.',
    close: 'Sluiten',
  },
};
