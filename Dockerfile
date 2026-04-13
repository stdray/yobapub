# Stage 1: Build frontend
FROM node:24-alpine AS frontend
WORKDIR /src
COPY src/front/package.json src/front/package-lock.json ./
RUN npm ci
COPY src/front/ .

ARG GITVERSION_SEMVER=dev
ARG GITVERSION_SHA=unknown
ARG GITVERSION_SHORT_SHA=unknown
ARG GITVERSION_COMMIT_DATE=unknown
ARG GITVERSION_BUILD_DATE=unknown
ENV GITVERSION_SEMVER=$GITVERSION_SEMVER
ENV GITVERSION_SHA=$GITVERSION_SHA
ENV GITVERSION_SHORT_SHA=$GITVERSION_SHORT_SHA
ENV GITVERSION_COMMIT_DATE=$GITVERSION_COMMIT_DATE
ENV GITVERSION_BUILD_DATE=$GITVERSION_BUILD_DATE

RUN npm run build:release

# Stage 2: Build backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY src/back/YobaPub.Proxy/YobaPub.Proxy.csproj .
RUN dotnet restore
COPY src/back/YobaPub.Proxy/ .
RUN dotnet publish -c Release -o /app

# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app .
COPY --from=frontend /src/dist/release wwwroot/
VOLUME ["/logs", "/keys/dataprotection"]
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "YobaPub.Proxy.dll"]
