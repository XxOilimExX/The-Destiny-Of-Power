export class WorldState {
  constructor(countries) {
    this.countries = countries;
    this.selectedCountryCode = countries[0]?.code ?? null;
  }

  setSelectedCountryCode(code) {
    const countryExists = this.countries.some((country) => country.code === code);

    if (countryExists) {
      this.selectedCountryCode = code;
    }
  }

  getSelectedCountry() {
    return this.countries.find((country) => country.code === this.selectedCountryCode) ?? null;
  }
}