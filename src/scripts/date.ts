export function formatDate(date: Date): string {
    let currentDate = new Date();
    if (currentDate.getDay() === date.getDate()) {
        return "today";
    }

    // TODO: smth smth locale support
    return date.toLocaleDateString("en-US", {})
}
