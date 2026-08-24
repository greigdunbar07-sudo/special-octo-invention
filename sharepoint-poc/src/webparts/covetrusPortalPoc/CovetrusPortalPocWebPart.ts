import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import { SPPermission } from '@microsoft/sp-page-context';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';

import CovetrusPortalPoc from './components/CovetrusPortalPoc';
import type { ICovetrusPortalPocProps } from './components/ICovetrusPortalPocProps';

export interface ICovetrusPortalPocWebPartProps {}

export default class CovetrusPortalPocWebPart extends BaseClientSideWebPart<ICovetrusPortalPocWebPartProps> {
  public render(): void {
    const user = this.context.pageContext.user;
    const element: React.ReactElement<ICovetrusPortalPocProps> = React.createElement(
      CovetrusPortalPoc,
      {
        userDisplayName: user.displayName || 'SharePoint user',
        userEmail: user.email || user.loginName || '',
        isSiteOwner: this.context.pageContext.web.permissions.hasPermission(SPPermission.manageWeb)
      }
    );

    ReactDom.render(element, this.domElement);
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }
}
