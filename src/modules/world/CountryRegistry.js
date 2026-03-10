import { countries } from "../../data/countries/countries.js";

export class CountryRegistry {
  constructor() {
    this.countries = countries;
  }

  getAll() {
    return this.countries;
  }
}