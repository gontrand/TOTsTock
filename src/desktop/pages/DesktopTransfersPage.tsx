import React from 'react';
import { TransfersValidationPanel } from '../../components/TransfersValidationPanel';

export const DesktopTransfersPage: React.FC = () => {
  return (
    <div className="h-full w-full flex flex-col">
      <TransfersValidationPanel isModal={false} />
    </div>
  );
};
