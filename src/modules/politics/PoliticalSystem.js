export class PoliticalSystem {
  calculateInfluence(country) {
    return Math.round((country.economyScore + country.stabilityScore) / 2);
  }
}