export function formatPopulation(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}