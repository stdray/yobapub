import * as doT from 'dot';

const tplCardCompiled = doT.template(`<div class="card" data-id="{{=it.id}}"><div class="card__poster"><img src="{{=it.poster}}" alt="">{{?it.extra}}<div class="card__badge">{{=it.extra}}</div>{{?}}</div><div class="card__title">{{=it.title}}</div></div>`);

export const tplCard = (data: { readonly id: number; readonly poster: string; readonly title: string; readonly extra?: string }): string =>
  tplCardCompiled(data);

const tplRatingCompiled = doT.template(`<span class="detail__rating">{{=it.label}} <span class="detail__rating-value">{{=it.value}}</span></span>`);

export const tplRating = (data: { readonly label: string; readonly value: number }): string =>
  tplRatingCompiled(data);

const tplEmptyTextCompiled = doT.template(`<div class="watching__section-title" style="margin-top:200px;text-align:center;">{{=it.text}}</div>`);

export const tplEmptyText = (data: { readonly text: string }): string =>
  tplEmptyTextCompiled(data);

export function renderRatings(item: { rating?: number; kinopoisk_rating?: number; imdb_rating?: number }): string {
  let html = '';
  if (item.rating) html += tplRating({ label: 'KP', value: item.rating });
  if (item.kinopoisk_rating) html += tplRating({ label: 'КиноПоиск', value: item.kinopoisk_rating });
  if (item.imdb_rating) html += tplRating({ label: 'IMDb', value: item.imdb_rating });
  return html;
}
