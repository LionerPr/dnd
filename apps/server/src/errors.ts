export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Не найдено') => new HttpError(404, what);
export const forbidden = (what = 'Нет доступа') => new HttpError(403, what);
