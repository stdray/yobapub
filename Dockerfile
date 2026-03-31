# Stage 1: Build frontend
FROM node:24-alpine AS frontend
WORKDIR /src
COPY src/front/package.json src/front/package-lock.json ./
RUN npm ci
COPY src/front/ .
RUN npx webpack --mode production

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
